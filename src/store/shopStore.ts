import { create } from "zustand";
import {
  ShopProduct,
  BoothProductDetail,
  RiperstoreSearchResult,
  tauriSearchShop,
  tauriRipperSearch,
  tauriGetBoothProductDetail,
  tauriRipperIsAuthenticated,
  tauriBoothFetchPurchases,
  tauriBoothIsAuthenticated,
  tauriBoothGetOwnedIds,
} from "../lib/tauri";
import { loadRiperstoreExperimental } from "./app";

interface ShopFilters {
  source: "all" | "booth" | "riperstore";
  priceType: "all" | "free" | "paid" | "owned";
}

interface ShopState {
  query: string;
  page: number;
  results: ShopProduct[];
  loading: boolean;
  error: string | null;
  selectedProduct: ShopProduct | null;
  filters: ShopFilters;
  boothOwnedIds: Set<string>;
  /** Total pages available in the last RipperStore search. Used by loadNextPage. */
  ripperPageCount: number;

  setQuery: (q: string) => void;
  setFilters: (f: Partial<ShopFilters>) => void;
  search: () => Promise<void>;
  selectProduct: (p: ShopProduct | null) => void;
  loadNextPage: () => Promise<void>;
  loadBoothOwnedIds: () => Promise<void>;
}

function normalizeTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palabras ignoradas al comparar títulos (artículos, preposiciones, conjunciones
 * y palabras de relleno comunes en nombres de assets de VRChat).
 */
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "in", "on", "at", "to",
  "with", "by", "from", "is", "it", "be", "as", "set", "pack", "full",
  "free", "ver", "version", "v", "dl", "bl",
]);

/** Devuelve el conjunto de palabras significativas de un título normalizado. */
function titleWords(name: string): Set<string> {
  return new Set(
    normalizeTitle(name)
      .split(" ")
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Coeficiente Jaccard entre los conjuntos de palabras de dos títulos.
 * 0 = sin palabras en común; 1 = idénticos.
 */
function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

/**
 * Combina resultados de Booth y Riperstore, deduplicando los assets que
 * aparecen en ambos.
 *
 * Estrategia de matching (en orden de prioridad):
 *  1. Booth ID exacto: un producto de Riperstore lleva `booth_ids[]` con los
 *     IDs que encontró en el contenido del post (líneas "BL:"). Si el
 *     `source_id` de un producto de Booth aparece en ese array, son el mismo
 *     asset — match perfecto.
 *  2. Título normalizado: fallback para cuando el post de Riperstore no tenía
 *     link de Booth o la búsqueda lo trajo solo por título.
 *
 * El resultado final:
 *  - Productos de Booth que tienen match con Riperstore: se muestran como
 *    producto de Booth (mejor thumbnail/precio) con `extra_sources` apuntando
 *    al hilo de Riperstore.
 *  - Productos de Riperstore sin match: se añaden al final tal cual.
 *  - Productos de Booth sin match: se añaden sin modificar.
 */
function mergeResults(booth: ShopProduct[], ripper: ShopProduct[]): ShopProduct[] {
  // Índice 1: Riperstore por cada uno de sus booth_ids → O(1) lookup
  const ripperByBoothId = new Map<string, ShopProduct>();
  // Índice 2: Riperstore por título normalizado → fallback
  const ripperByTitle = new Map<string, ShopProduct>();

  for (const rp of ripper) {
    ripperByTitle.set(normalizeTitle(rp.name), rp);
    if (rp.booth_ids) {
      for (const bid of rp.booth_ids) {
        ripperByBoothId.set(bid, rp);
      }
    }
  }

  const merged: ShopProduct[] = [];
  const consumedRipperTids = new Set<string>();

  for (const bp of booth) {
    // Prioridad 1: match por Booth ID exacto — es autoritativo.
    // Si el post de Riperstore incluyó "BL: booth.pm/items/XXXX" con este ID,
    // el match es definitivo independientemente de la similitud de título
    // (p.ej. "FOR AIRI - SomeOutfit" vs "SomeOutfit [Airi compatible]").
    const rpById = ripperByBoothId.get(bp.source_id);
    // Prioridad 2: match por título (fallback)
    const rpByTitle = ripperByTitle.get(normalizeTitle(bp.name));
    const rp = rpById ?? rpByTitle;

    if (rp) {
      consumedRipperTids.add(rp.source_id);
      merged.push({
        ...bp,
        extra_sources: [{ source: rp.source, source_id: rp.source_id, url: rp.url }],
      });
    } else {
      merged.push(bp);
    }
  }

  // Añadir los de Riperstore que no tuvieron match con ningún producto de Booth
  for (const rp of ripper) {
    if (!consumedRipperTids.has(rp.source_id)) {
      merged.push(rp);
    }
  }

  return merged;
}

// ── Booth ID / URL detection ───────────────────────────────────────────────────

/**
 * Extrae el ID numérico de Booth de una URL completa o de un ID suelto.
 * Acepta:
 *   - "6082686"  (solo dígitos, 5-8 cifras)
 *   - "https://booth.pm/en/items/6082686"
 *   - "https://xxx.booth.pm/items/6082686"
 * Devuelve el ID como string, o null si no coincide.
 */
function extractBoothId(query: string): string | null {
  const trimmed = query.trim();
  // Purely numeric (5–8 digits) → treat as Booth item ID
  if (/^\d{5,8}$/.test(trimmed)) return trimmed;
  // Full URL pattern
  const m = trimmed.match(/booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/);
  return m ? m[1] : null;
}

/** Convierte un BoothProductDetail en un ShopProduct sintético para la grid. */
function detailToShopProduct(d: BoothProductDetail): ShopProduct {
  return {
    source_id: d.source_id,
    name: d.name,
    author: d.author,
    thumbnail_url: d.images[0] || "",
    price_display: d.price_display,
    url: d.url,
    source: "booth",
  };
}

/**
 * Fetches results from both Booth and Riperstore in parallel.
 *
 * Strategy:
 *   1. If the query is a Booth ID or URL, fetch the item directly by ID and
 *      search Riperstore for that ID — skips the text search entirely.
 *   2. Otherwise: parallel text search on Booth + primary Riperstore search,
 *      followed by a secondary Riperstore search by each Booth ID returned
 *      (catches threads titled "FOR AIRI" whose body has "BL: booth.pm/items/6082686").
 *
 * Returns merged products plus the total page count from Riperstore.
 */
async function fetchCombined(
  query: string,
  page: number
): Promise<{ products: ShopProduct[]; ripperPageCount: number }> {
  const EMPTY_RIPPER: RiperstoreSearchResult = { products: [], page_count: 1, current_page: 1 };
  // Gate: Riperstore only runs when the experimental flag is enabled
  const riperstoreEnabled = loadRiperstoreExperimental();
  const ripperAuthenticated = riperstoreEnabled && await tauriRipperIsAuthenticated();

  // ── Booth ID / URL mode ────────────────────────────────────────────────────
  // Si el query es un ID numérico o una URL de Booth, buscamos el item
  // directamente por ID en lugar de usar el buscador de texto.
  const boothId = extractBoothId(query);
  if (boothId) {
    let boothProduct: ShopProduct | null = null;
    try {
      const detail = await tauriGetBoothProductDetail(boothId);
      if (detail.name) boothProduct = detailToShopProduct(detail);
    } catch (e) {
      console.warn("[BoothID] detail fetch failed:", e);
    }

    // Buscar en Riperstore por el ID exacto en paralelo
    let ripperById: ShopProduct[] = [];
    if (ripperAuthenticated) {
      try {
        const r = await tauriRipperSearch(boothId, 1);
        ripperById = r.products;
      } catch (e) {
        console.warn("[BoothID] Riperstore search failed:", e);
      }
    }

    const boothResults = boothProduct ? [boothProduct] : [];
    const merged = mergeResults(boothResults, ripperById);
    return { products: merged, ripperPageCount: 1 };
  }

  // ── Búsqueda por texto normal ──────────────────────────────────────────────
  const boothPromise = tauriSearchShop(query, page);

  // Primary Riperstore search
  const ripperPromise: Promise<RiperstoreSearchResult> = ripperAuthenticated
    ? tauriRipperSearch(query, page).catch((e) => {
        console.warn("[Riperstore] primary search failed:", e);
        return EMPTY_RIPPER;
      })
    : Promise.resolve(EMPTY_RIPPER);

  const [boothResults, ripperResult] = await Promise.all([boothPromise, ripperPromise]);
  const ripper1 = ripperResult.products;

  // Secondary Riperstore search by Booth IDs (for "FOR AIRI"-style threads)
  let ripper2: ShopProduct[] = [];
  if (ripperAuthenticated && boothResults.length > 0) {
    const primaryBoothIds = new Set(
      ripper1.flatMap((p) => p.booth_ids ?? [])
    );
    const boothIds = boothResults
      .map((b) => b.source_id)
      .filter((id) => !primaryBoothIds.has(id))
      .slice(0, 8);

    if (boothIds.length > 0) {
      const secondaryResults = await Promise.allSettled(
        boothIds.map((id) => tauriRipperSearch(id, 1))
      );
      const seenTids = new Set(ripper1.map((p) => p.source_id));
      ripper2 = secondaryResults
        .filter((r): r is PromiseFulfilledResult<RiperstoreSearchResult> => r.status === "fulfilled")
        .flatMap((r) => r.value.products)
        .filter((p) => !seenTids.has(p.source_id));
    }
  }

  const merged = mergeResults(boothResults, [...ripper1, ...ripper2]);
  return { products: merged, ripperPageCount: ripperResult.page_count };
}

function isFreePrice(price: string): boolean {
  const normalized = price.trim().toLowerCase();
  return (
    normalized === "free" ||
    normalized === "¥0" ||
    normalized === "0" ||
    normalized === "$0" ||
    normalized === "0円"
  );
}

function applyFilters(
  products: ShopProduct[],
  filters: ShopFilters,
  boothOwnedIds: Set<string>
): ShopProduct[] {
  let result = products;

  if (filters.source !== "all") {
    result = result.filter((r) => r.source === filters.source);
  }

  if (filters.priceType === "free") {
    result = result.filter((r) => isFreePrice(r.price_display));
  } else if (filters.priceType === "paid") {
    result = result.filter((r) => !isFreePrice(r.price_display));
  } else if (filters.priceType === "owned") {
    result = result.filter(
      (r) => r.source === "booth" && boothOwnedIds.has(r.source_id)
    );
  }

  return result;
}

export const useShopStore = create<ShopState>((set, get) => ({
  query: "",
  page: 1,
  results: [],
  loading: false,
  error: null,
  selectedProduct: null,
  filters: { source: "all", priceType: "all" },
  boothOwnedIds: new Set<string>(),
  ripperPageCount: 1,

  setQuery: (q) => set({ query: q, page: 1, results: [], ripperPageCount: 1 }),

  setFilters: (f) => {
    set((s) => ({ filters: { ...s.filters, ...f }, page: 1, results: [] }));
    const { query } = get();
    if (query.trim()) {
      get().search();
    }
  },

  search: async () => {
    const { query, filters, boothOwnedIds } = get();
    if (!query.trim()) return;
    set({ loading: true, error: null, page: 1 });
    try {
      const { products, ripperPageCount } = await fetchCombined(query, 1);
      const filtered = applyFilters(products, filters, boothOwnedIds);
      set({ results: filtered, loading: false, ripperPageCount });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectProduct: (p) => set({ selectedProduct: p }),

  loadNextPage: async () => {
    const { query, page, results, filters, boothOwnedIds, ripperPageCount } = get();
    if (page >= ripperPageCount) return;
    const nextPage = page + 1;
    set({ loading: true, page: nextPage });
    try {
      const { products: more } = await fetchCombined(query, nextPage);
      const existingKeys = new Set(results.map((r) => `${r.source}:${r.source_id}`));
      const newItems = more.filter((r) => !existingKeys.has(`${r.source}:${r.source_id}`));
      const filteredMore = applyFilters(newItems, filters, boothOwnedIds);
      set({ results: [...results, ...filteredMore], loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadBoothOwnedIds: async () => {
    try {
      const isAuth = await tauriBoothIsAuthenticated();
      if (!isAuth) return;
      let ids = await tauriBoothGetOwnedIds();
      if (ids.length === 0) {
        ids = await tauriBoothFetchPurchases();
      }
      set({ boothOwnedIds: new Set(ids) });
    } catch (e) {
      console.error("Failed to load Booth owned IDs:", e);
    }
  },
}));
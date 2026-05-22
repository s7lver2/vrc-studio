import { create } from "zustand";
import {
  ShopProduct,
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
import { BoothProductDetail } from "@/lib/tauri";
import { isUntrustedSourcesUnlocked } from "@/hooks/useUntrustedSources";

// ── Nuevo tipo (también se añadirá a lib/tauri.ts) ────────────────────────────
export interface ShopAuthor {
  name: string;
  product_count: number;
  sample_thumbnail: string;
  sample_products: ShopProduct[];
}

interface ShopFilters {
  source: "all" | "booth" | "riperstore";
  priceType: "all" | "free" | "paid" | "owned";
  searchMode: "items" | "authors"; // ← nuevo
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
  recentSearches: string[];
  /** Total pages available in the last RipperStore search. Used by loadNextPage. */
  ripperPageCount: number;
  // ── Nuevos campos para autores ─────────────────────────────────────────────
  authorResults: ShopAuthor[];
  selectedAuthor: ShopAuthor | null;
  setSelectedAuthor: (author: ShopAuthor | null) => void;

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

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "in", "on", "at", "to",
  "with", "by", "from", "is", "it", "be", "as", "set", "pack", "full",
  "free", "ver", "version", "v", "dl", "bl",
]);

function titleWords(name: string): Set<string> {
  return new Set(
    normalizeTitle(name)
      .split(" ")
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function titleSimilarity(a: string, b: string): number {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / (wa.size + wb.size - intersection);
}

// ── Agrupar productos por autor ────────────────────────────────────────────────
function groupByAuthor(products: ShopProduct[]): ShopAuthor[] {
  const map = new Map<string, ShopAuthor>();
  for (const p of products) {
    const key = p.author.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        name: p.author,
        product_count: 0,
        sample_thumbnail: p.thumbnail_url,
        sample_products: [],
      });
    }
    const entry = map.get(key)!;
    entry.product_count++;
    if (entry.sample_products.length < 6) {
      entry.sample_products.push(p);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.product_count - a.product_count);
}

function mergeResults(booth: ShopProduct[], ripper: ShopProduct[]): ShopProduct[] {
  const ripperByBoothId = new Map<string, ShopProduct>();
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
    const rpById = ripperByBoothId.get(bp.source_id);
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

  for (const rp of ripper) {
    if (!consumedRipperTids.has(rp.source_id)) {
      merged.push(rp);
    }
  }

  return merged;
}

function extractBoothId(query: string): string | null {
  const trimmed = query.trim();
  if (/^\d{5,8}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/booth\.pm\/(?:[a-z]{2}\/)?items\/(\d+)/);
  return m ? m[1] : null;
}

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

async function fetchCombined(
  query: string,
  page: number
): Promise<{ products: ShopProduct[]; ripperPageCount: number }> {
  const EMPTY_RIPPER: RiperstoreSearchResult = { products: [], page_count: 1, current_page: 1 };
  const riperstoreEnabled = isUntrustedSourcesUnlocked() && loadRiperstoreExperimental();
  const ripperAuthenticated = riperstoreEnabled && await tauriRipperIsAuthenticated();

  const boothId = extractBoothId(query);
  if (boothId) {
    let boothProduct: ShopProduct | null = null;
    try {
      const detail = await tauriGetBoothProductDetail(boothId);
      if (detail.name) boothProduct = detailToShopProduct(detail);
    } catch (e) {
      console.warn("[BoothID] detail fetch failed:", e);
    }

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

  const boothPromise = tauriSearchShop(query, page);
  const ripperPromise: Promise<RiperstoreSearchResult> = ripperAuthenticated
    ? tauriRipperSearch(query, page).catch((e) => {
        console.warn("[Riperstore] primary search failed:", e);
        return EMPTY_RIPPER;
      })
    : Promise.resolve(EMPTY_RIPPER);

  const [boothResults, ripperResult] = await Promise.all([boothPromise, ripperPromise]);
  const ripper1 = ripperResult.products;

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
  filters: { source: "all", priceType: "all", searchMode: "items" },
  boothOwnedIds: new Set<string>(),
  ripperPageCount: 1,
  authorResults: [],
  selectedAuthor: null,
  setSelectedAuthor: (author) => set({ selectedAuthor: author }),
  // ── Cargar historial reciente desde localStorage ──
  recentSearches: (() => {
    try {
      return JSON.parse(localStorage.getItem("shop:recentSearches") ?? "[]");
    } catch {
      return [];
    }
  })(),

  setQuery: (q) => set({ query: q, page: 1, results: [], ripperPageCount: 1, authorResults: [], selectedAuthor: null }),

  setFilters: (f) => {
    set((s) => {
      const newFilters = { ...s.filters, ...f };
      return {
        filters: newFilters,
        page: 1,
        results: [],
        authorResults: [],
        selectedAuthor: null,
      };
    });
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

      // ── Guardar búsqueda reciente ──
      const { recentSearches } = get();
      const trimmed = query.trim();
      if (trimmed && !recentSearches.includes(trimmed)) {
        const updated = [trimmed, ...recentSearches].slice(0, 20);
        set({ recentSearches: updated });
        try {
          localStorage.setItem("shop:recentSearches", JSON.stringify(updated));
        } catch {}
      }

      // ── Agrupar por autor si estamos en modo "authors" ──
      const allProducts = applyFilters(products, { ...filters, priceType: "all" }, boothOwnedIds);
      const authorResults =
        filters.searchMode === "authors"
          ? groupByAuthor(products) // sobre todos los productos, sin filtro de priceType
          : [];
      set({
        results: filtered,
        loading: false,
        ripperPageCount,
        authorResults,
      });
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
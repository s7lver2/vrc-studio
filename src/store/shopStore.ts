import { create } from "zustand";
import {
  ShopProduct,
  tauriSearchShop,
  tauriGetBoothProductDetail,
  tauriBoothFetchPurchases,
  tauriBoothIsAuthenticated,
  tauriBoothGetOwnedIds,
} from "../lib/tauri";
import { BoothProductDetail } from "@/lib/tauri";
import { useAppStore } from "./app";

export interface ShopAuthor {
  name: string;
  product_count: number;
  sample_thumbnail: string;
  sample_products: ShopProduct[];
}

interface ShopFilters {
  priceType: "all" | "free" | "paid" | "owned";
  searchMode: "items" | "authors";
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
  return name.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "of", "in", "on", "at", "to",
  "with", "by", "from", "is", "it", "be", "as", "set", "pack", "full",
  "free", "ver", "version", "v", "dl", "bl",
]);

function titleWords(name: string): Set<string> {
  return new Set(
    normalizeTitle(name).split(" ").filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function groupByAuthor(products: ShopProduct[]): ShopAuthor[] {
  const map = new Map<string, ShopAuthor>();
  for (const p of products) {
    const key = p.author.trim().toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: p.author, product_count: 0, sample_thumbnail: p.thumbnail_url, sample_products: [] });
    }
    const entry = map.get(key)!;
    entry.product_count++;
    if (entry.sample_products.length < 6) entry.sample_products.push(p);
  }
  return Array.from(map.values()).sort((a, b) => b.product_count - a.product_count);
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

function isFreePrice(price: string): boolean {
  const n = price.trim().toLowerCase();
  return n === "free" || n === "¥0" || n === "0" || n === "$0" || n === "0円";
}

function applyFilters(products: ShopProduct[], filters: ShopFilters, boothOwnedIds: Set<string>): ShopProduct[] {
  let result = products;
  if (filters.priceType === "free") result = result.filter(r => isFreePrice(r.price_display));
  else if (filters.priceType === "paid") result = result.filter(r => !isFreePrice(r.price_display));
  else if (filters.priceType === "owned") result = result.filter(r => r.source === "booth" && boothOwnedIds.has(r.source_id));
  return result;
}

export const useShopStore = create<ShopState>((set, get) => ({
  query: "",
  page: 1,
  results: [],
  loading: false,
  error: null,
  selectedProduct: null,
  filters: { priceType: "all", searchMode: "items" },
  boothOwnedIds: new Set<string>(),
  authorResults: [],
  selectedAuthor: null,
  setSelectedAuthor: (author) => set({ selectedAuthor: author }),
  recentSearches: (() => {
    try { return JSON.parse(localStorage.getItem("shop:recentSearches") ?? "[]"); } catch { return []; }
  })(),

  setQuery: (q) => set({ query: q, page: 1, results: [], authorResults: [], selectedAuthor: null }),

  setFilters: (f) => {
    set((s) => ({ filters: { ...s.filters, ...f }, page: 1, results: [], authorResults: [], selectedAuthor: null }));
    if (get().query.trim()) get().search();
  },

  search: async () => {
    const { query, filters, boothOwnedIds } = get();
    if (!query.trim()) return;
    set({ loading: true, error: null, page: 2 });
    try {
      const showAdult = useAppStore.getState().showAdultContent;
      const boothId = extractBoothId(query);
      let products: ShopProduct[];

      if (boothId) {
        try {
          const detail = await tauriGetBoothProductDetail(boothId);
          products = detail.name ? [detailToShopProduct(detail)] : [];
        } catch { products = []; }
      } else {
        // Fetch pages 1 and 2 simultaneously — doubles initial results at no extra latency cost
        const [p1, p2] = await Promise.all([
          tauriSearchShop(query, 1, showAdult),
          tauriSearchShop(query, 2, showAdult),
        ]);
        const seen = new Set<string>();
        products = [];
        for (const p of [...p1, ...p2]) {
          const key = `${p.source}:${p.source_id}`;
          if (!seen.has(key)) { seen.add(key); products.push(p); }
        }
      }

      const filtered = applyFilters(products, filters, boothOwnedIds);
      const trimmed = query.trim();
      const { recentSearches } = get();
      if (trimmed && !recentSearches.includes(trimmed)) {
        const updated = [trimmed, ...recentSearches].slice(0, 20);
        set({ recentSearches: updated });
        try { localStorage.setItem("shop:recentSearches", JSON.stringify(updated)); } catch {}
      }
      const authorResults = filters.searchMode === "authors" ? groupByAuthor(products) : [];
      // page: 2 since we already fetched pages 1+2; loadNextPage will start at 3
      set({ results: filtered, loading: false, page: 2, authorResults });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  selectProduct: (p) => set({ selectedProduct: p }),

  loadNextPage: async () => {
    const { query, page, results, filters, boothOwnedIds } = get();
    const nextPage = page + 1;
    set({ loading: true, page: nextPage });
    try {
      const showAdult = useAppStore.getState().showAdultContent;
      const more = await tauriSearchShop(query, nextPage, showAdult);
      const existingKeys = new Set(results.map(r => `${r.source}:${r.source_id}`));
      const newItems = more.filter(r => !existingKeys.has(`${r.source}:${r.source_id}`));
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
      if (ids.length === 0) ids = await tauriBoothFetchPurchases();
      set({ boothOwnedIds: new Set(ids) });
    } catch (e) {
      console.error("[booth] loadBoothOwnedIds failed:", e);
    }
  },
}));

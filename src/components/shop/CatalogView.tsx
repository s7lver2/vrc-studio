// CatalogView — infinite-scroll catalog with category + price filters
// Queries use both Japanese (Booth standard) and English terms for maximum coverage.
import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2, LayoutGrid } from "lucide-react";
import { tauriSearchShop, ShopProduct } from "../../lib/tauri";
import { ProductCard } from "./ProductCard";
import { useAppStore } from "../../store/app";
import { useAppearanceStore } from "@/store/appearanceStore";

// ── Categories ────────────────────────────────────────────────────────────────
//
// Each category has a primary query (used for infinite scroll pages 3+) and
// optional extra queries merged into the initial load (pages 1+2 of each).
//
// Japanese terms are critical — Booth is a Japanese marketplace.
// Most VRChat sellers use:
//   衣装 = clothing/outfit  アクセサリ = accessory  髪型 = hairstyle
//   完成品 = finished product  オリジナルアバター = original avatar
//
// Avatar base names in katakana are especially powerful: searching "ライム VRChat"
// returns both the Lime avatar base itself AND all clothing/accessories made for it.

const CATALOG_CATEGORIES = [
  {
    id: "all",
    label: "All",
    queries: ["VRChat", "VRChat アバター 衣装"],
  },
  {
    id: "avatars",
    label: "Avatars",
    // 完成品 = "finished product" — common tag for complete avatar packages
    queries: ["VRChat オリジナルアバター", "VRChat アバター 完成品"],
  },
  {
    id: "clothing",
    label: "Clothing",
    // Generic clothing tags + popular avatar base names combined with 衣装 (outfit).
    // "ライム 衣装" returns all clothing made specifically for the Lime avatar, etc.
    // This dramatically increases results since most clothing is tagged by target avatar.
    queries: [
      "VRChat 衣装",      // generic VRChat clothing
      "ライム 衣装",       // Lime outfits
      "マヌカ 衣装",       // Manuka outfits
      "キキョウ 衣装",     // Kikyo outfits
      "アノン 衣装",       // Anon outfits
      "チセ 衣装",         // Chise outfits
    ],
  },
  {
    id: "accessories",
    label: "Accessories",
    // Generic accessory tags + popular bases (accessory makers tag by target avatar)
    queries: [
      "VRChat アクセサリ",  // generic accessories
      "ライム アクセサリ",   // Lime accessories
      "マヌカ アクセサリ",   // Manuka accessories
      "VRChat 髪型",        // hairstyles
    ],
  },
  {
    id: "shaders",
    label: "Shaders",
    queries: ["liltoon", "poiyomi shader VRChat"],
  },
  {
    id: "tools",
    label: "Tools",
    queries: ["VRChat unity ツール", "VRCFury modular avatar"],
  },
] as const;

type CategoryId = (typeof CATALOG_CATEGORIES)[number]["id"];
type PriceFilter = "all" | "free" | "paid";

function isFree(price: string) {
  const n = price.trim().toLowerCase();
  return n === "free" || n === "¥0" || n === "0" || n === "$0" || n === "0円";
}

function filterByPrice(items: ShopProduct[], price: PriceFilter): ShopProduct[] {
  if (price === "free") return items.filter(i => isFree(i.price_display));
  if (price === "paid") return items.filter(i => !isFree(i.price_display));
  return items;
}

/** Merge multiple result arrays, deduplicating by source+source_id. */
function mergeDedup(batches: ShopProduct[][]): ShopProduct[] {
  const seen = new Set<string>();
  const out: ShopProduct[] = [];
  for (const batch of batches) {
    for (const item of batch) {
      const key = `${item.source}:${item.source_id}`;
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
  }
  return out;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="aspect-square bg-zinc-800 animate-pulse" />
      <div className="p-2 flex flex-col gap-1.5">
        <div className="h-3 bg-zinc-800 rounded animate-pulse" />
        <div className="h-2.5 bg-zinc-800 rounded animate-pulse w-2/3" />
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CatalogViewProps {
  onClose: () => void;
}

export function CatalogView({ onClose }: CatalogViewProps) {
  const [category, setCategory] = useState<CategoryId>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [results, setResults] = useState<ShopProduct[]>([]);
  // page tracks the NEXT page to fetch for the primary query (infinite scroll)
  const [nextPage, setNextPage] = useState(3);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef<HTMLDivElement>(null);
  const showAdult = useAppStore((s) => s.showAdultContent);
  const shopItemSize = useAppearanceStore((s) => s.shopItemSize);

  const cardSizes = {
    compact: { min: 120, max: 148 },
    normal:  { min: 160, max: 196 },
    large:   { min: 210, max: 256 },
  }[shopItemSize ?? "normal"];

  const currentCat = CATALOG_CATEGORIES.find(c => c.id === category)!;

  // ── Initial load: fetch pages 1+2 of ALL queries in parallel ───────────────

  const loadInitial = useCallback(async (
    cat: typeof currentCat,
    price: PriceFilter,
  ) => {
    setLoading(true);
    setResults([]);
    setHasMore(true);
    try {
      // pages 1 AND 2 of every query in parallel → e.g. 4 requests for 2-query category
      const promises = cat.queries.flatMap(q => [
        tauriSearchShop(q, 1, showAdult),
        tauriSearchShop(q, 2, showAdult),
      ]);
      const batches = await Promise.all(promises);
      const merged = filterByPrice(mergeDedup(batches), price);
      setResults(merged);
      // Infinite scroll continues from page 3 of the primary query
      setNextPage(3);
      setHasMore(batches.some(b => b.length > 0));
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  // showAdult is stable (app setting), safe to include
  }, [showAdult]);

  // ── Load more: paginate primary query ──────────────────────────────────────

  const loadMore = useCallback(async (
    primaryQuery: string,
    page: number,
    price: PriceFilter,
  ) => {
    setLoading(true);
    try {
      const raw = await tauriSearchShop(primaryQuery, page, showAdult);
      const filtered = filterByPrice(raw, price);
      setResults(prev => {
        const seen = new Set(prev.map(r => `${r.source}:${r.source_id}`));
        return [...prev, ...filtered.filter(r => !seen.has(`${r.source}:${r.source_id}`))];
      });
      setNextPage(page + 1);
      setHasMore(raw.length > 0 && page < 12);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [showAdult]);

  // ── Reset on category / price filter change ────────────────────────────────

  useEffect(() => {
    const cat = CATALOG_CATEGORIES.find(c => c.id === category)!;
    loadInitial(cat, priceFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, priceFilter]);

  // ── Infinite scroll via IntersectionObserver (stable ref pattern) ──────────

  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const nextPageRef = useRef(nextPage);
  nextPageRef.current = nextPage;
  const catRef = useRef(currentCat);
  catRef.current = currentCat;
  const priceRef = useRef(priceFilter);
  priceRef.current = priceFilter;

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingRef.current && hasMoreRef.current) {
        loadMore(catRef.current.queries[0], nextPageRef.current, priceRef.current);
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  // Stable: only recreate if loadMore changes (i.e. showAdult changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMore]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const gridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${cardSizes.min}px, ${cardSizes.max}px))`,
  };

  return (
    <div className="fixed inset-0 z-[200] bg-zinc-950 flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2.5">
          <LayoutGrid className="h-4 w-4 text-red-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Browse Catalog</h2>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ── Filters bar ── */}
      <div className="shrink-0 px-6 py-3 border-b border-zinc-800 bg-zinc-950 flex flex-col gap-2.5">
        {/* Category tabs */}
        <div className="flex gap-1.5 flex-wrap">
          {CATALOG_CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`px-3 py-1.5 text-xs rounded-full border font-medium transition-colors ${
                category === c.id
                  ? "bg-red-600 border-red-600 text-white"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {/* Price filter + result count */}
        <div className="flex items-center gap-1.5">
          {(["all", "free", "paid"] as PriceFilter[]).map(p => (
            <button
              key={p}
              onClick={() => setPriceFilter(p)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                priceFilter === p
                  ? "bg-zinc-600 border-zinc-600 text-white"
                  : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
              }`}
            >
              {p === "all" ? "Any price" : p === "free" ? "Free" : "Paid"}
            </button>
          ))}
          {results.length > 0 && (
            <span className="ml-auto text-xs text-zinc-600">
              {results.length}+ items
            </span>
          )}
        </div>
      </div>

      {/* ── Results ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {results.length === 0 && loading ? (
          <div className="grid gap-3" style={gridStyle}>
            {Array.from({ length: 24 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : results.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
            No results
          </div>
        ) : (
          <>
            <div className="grid gap-3" style={gridStyle}>
              {results.map(p => (
                <ProductCard key={`${p.source}-${p.source_id}`} product={p} />
              ))}
            </div>
            {/* Sentinel for IntersectionObserver */}
            <div ref={loaderRef} className="flex justify-center py-8">
              {loading && <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />}
              {!loading && !hasMore && results.length > 0 && (
                <p className="text-xs text-zinc-700">End of catalog</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

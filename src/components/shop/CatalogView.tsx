// CatalogView — infinite-scroll catalog with category + price filters
import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2, LayoutGrid } from "lucide-react";
import { tauriSearchShop, ShopProduct } from "../../lib/tauri";
import { ProductCard } from "./ProductCard";
import { useAppStore } from "../../store/app";
import { useAppearanceStore } from "@/store/appearanceStore";

// ── Categories ────────────────────────────────────────────────────────────────

const CATALOG_CATEGORIES = [
  { id: "all",         label: "All",         query: "vrchat" },
  { id: "avatars",     label: "Avatars",      query: "vrchat avatar 3d model" },
  { id: "clothing",    label: "Clothing",     query: "vrchat clothing outfit wearable" },
  { id: "accessories", label: "Accessories",  query: "vrchat accessory hair props" },
  { id: "shaders",     label: "Shaders",      query: "vrchat shader liltoon poiyomi" },
  { id: "tools",       label: "Tools",        query: "vrchat unity tools scripts" },
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
  const [page, setPage] = useState(1);
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

  const currentQuery = CATALOG_CATEGORIES.find(c => c.id === category)?.query ?? "vrchat";

  // ── Fetch helper ────────────────────────────────────────────────────────────

  const fetchPage = useCallback(async (
    query: string,
    pageNum: number,
    price: PriceFilter,
    reset: boolean,
  ) => {
    setLoading(true);
    try {
      const raw = await tauriSearchShop(query, pageNum, showAdult);
      const filtered = filterByPrice(raw, price);
      if (reset) {
        setResults(filtered);
      } else {
        setResults(prev => {
          const seen = new Set(prev.map(r => `${r.source}:${r.source_id}`));
          return [...prev, ...filtered.filter(r => !seen.has(`${r.source}:${r.source_id}`))];
        });
      }
      setHasMore(raw.length > 0 && pageNum < 10);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [showAdult]);

  // ── Reset on category / price change ───────────────────────────────────────

  useEffect(() => {
    setResults([]);
    setPage(1);
    setHasMore(true);
    fetchPage(currentQuery, 1, priceFilter, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, priceFilter]);

  // ── Infinite scroll via IntersectionObserver ───────────────────────────────

  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const pageRef = useRef(page);
  pageRef.current = page;
  const queryRef = useRef(currentQuery);
  queryRef.current = currentQuery;
  const priceRef = useRef(priceFilter);
  priceRef.current = priceFilter;

  useEffect(() => {
    const el = loaderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingRef.current && hasMoreRef.current) {
        const next = pageRef.current + 1;
        setPage(next);
        fetchPage(queryRef.current, next, priceRef.current, false);
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  // Only create observer once; refs keep values fresh without causing re-creation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage]);

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
        {/* Price filter */}
        <div className="flex gap-1.5">
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
            <span className="ml-auto text-xs text-zinc-600 self-center">
              {results.length}+ results
            </span>
          )}
        </div>
      </div>

      {/* ── Results ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {results.length === 0 && loading ? (
          // Initial skeleton
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
              {!loading && !hasMore && (
                <p className="text-xs text-zinc-700">End of catalog</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

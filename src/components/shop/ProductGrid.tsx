import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useShopStore } from "../../store/shopStore";
import { ProductCard } from "./ProductCard";
import { useAppearanceStore } from "@/store/appearanceStore";


function ProductCardSkeleton() {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden">
      <div className="aspect-square bg-zinc-800 animate-pulse" />
      <div className="p-2.5 flex flex-col gap-2">
        <div className="h-3.5 bg-zinc-800 rounded animate-pulse" />
        <div className="h-3 bg-zinc-800 rounded animate-pulse w-3/4" />
        <div className="flex items-center justify-between mt-1 gap-1">
          <div className="h-3 w-10 bg-zinc-800 rounded animate-pulse" />
          <div className="h-4 w-12 bg-zinc-800 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function ProductGrid() {
  const { results, loading, error, loadNextPage, page } = useShopStore();
  const hasMore = page < 8;
  const shopItemSize = useAppearanceStore((s) => s.shopItemSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const cardSizes = {
    compact: { min: 120, max: 148 },
    normal:  { min: 160, max: 196 },
    large:   { min: 210, max: 256 },
  }[shopItemSize];
  const gridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(${cardSizes.min}px, ${cardSizes.max}px))`,
  };

  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !loadingRef.current && hasMoreRef.current) {
        loadNextPage();
      }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadNextPage]);

  if (loading && results.length === 0) {
    return (
      <div className="grid gap-3" style={gridStyle}>
        {Array.from({ length: 18 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-500 text-sm">
        No results. Search for something above.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3" style={gridStyle}>
        {results.map((p) => (
          <ProductCard key={`${p.source}-${p.source_id}`} product={p} />
        ))}
      </div>

      <div ref={sentinelRef} className="flex justify-center py-8">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />}
        {!loading && !hasMore && results.length > 0 && (
          <p className="text-xs text-zinc-700">End of results</p>
        )}
      </div>
    </div>
  );
}

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
  const { results, loading, error, loadNextPage } = useShopStore();
  const shopItemSize = useAppearanceStore((s) => s.shopItemSize);

  const gridCols = {
    compact: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
    normal:  "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    large:   "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4",
  }[shopItemSize];

  if (loading && results.length === 0) {
    return (
      <div className={`grid ${gridCols} gap-3`}>
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
      <div className={`grid ${gridCols} gap-3`}>
        {results.map((p) => (
          <ProductCard key={`${p.source}-${p.source_id}`} product={p} />
        ))}
      </div>

      <div className="flex justify-center pb-4">
        <button
          className="px-4 py-2 text-sm rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors disabled:opacity-50 flex items-center gap-2"
          onClick={loadNextPage}
          disabled={loading}
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Load more
        </button>
      </div>
    </div>
  );
}
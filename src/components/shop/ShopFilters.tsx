import { ShoppingBag } from "lucide-react";
import { useShopStore } from "../../store/shopStore";
import { useT } from "@/i18n";

export function ShopFilters() {
  const t = useT();
  const { filters, setFilters } = useShopStore();

  const PRICE_TYPES = [
    { value: "all",  label: t("shop_filters_price_any") },
    { value: "free", label: t("shop_filters_free") },
    { value: "paid", label: t("shop_filters_paid") },
  ] as const;

  const isOwned = filters.priceType === "owned";

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex gap-1.5">
        {PRICE_TYPES.map((p) => (
          <button
            key={p.value}
            onClick={() => setFilters({ priceType: p.value })}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filters.priceType === p.value
                ? "bg-red-600 border-red-600 text-white"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setFilters({ priceType: isOwned ? "all" : "owned" })}
          className={`flex items-center gap-1 px-3 py-1 text-xs rounded-full border transition-colors ${
            isOwned
              ? "bg-violet-600 border-violet-600 text-white"
              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        >
          <ShoppingBag className="h-3 w-3" />
          Owned
        </button>
      </div>
      <div className="flex gap-1 bg-zinc-800 rounded-lg p-1">
        <button
          onClick={() => setFilters({ searchMode: "items" })}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors
            ${filters.searchMode === "items" || !filters.searchMode
              ? "bg-zinc-600 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Items
        </button>
        <button
          onClick={() => setFilters({ searchMode: "authors" })}
          className={`px-3 py-1 rounded text-xs font-medium transition-colors
            ${filters.searchMode === "authors"
              ? "bg-zinc-600 text-zinc-100"
              : "text-zinc-400 hover:text-zinc-200"}`}
        >
          Authors
        </button>
      </div>
    </div>
  );
}

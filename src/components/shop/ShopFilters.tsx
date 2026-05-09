import { useShopStore } from "../../store/shopStore";
import { useT } from "@/i18n";

export function ShopFilters() {
  const t = useT();
  const { filters, setFilters } = useShopStore();

  const SOURCES = [
    { value: "all",        label: t("shop_filters_all_sources") },
    { value: "booth",      label: t("shop_filters_booth") },
    { value: "riperstore", label: t("shop_filters_riperstore") },
  ] as const;

  const PRICE_TYPES = [
    { value: "all",  label: t("shop_filters_price_any") },
    { value: "free", label: t("shop_filters_free") },
    { value: "paid", label: t("shop_filters_paid") },
  ] as const;

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex gap-1.5">
        {SOURCES.map((s) => (
          <button
            key={s.value}
            onClick={() => setFilters({ source: s.value })}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filters.source === s.value
                ? "bg-red-600 border-red-600 text-white"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="w-px h-4 bg-zinc-700" />
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
      </div>
    </div>
  );
}
import { useShopStore } from "../../store/shopStore";

const SOURCES = [
  { value: "all", label: "All sources" },
  { value: "booth", label: "Booth.pm" },
  { value: "riperstore", label: "Riperstore" },
] as const;

const PRICE_TYPES = [
  { value: "all", label: "Any price" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
] as const;

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-full border transition-colors ${
        active
          ? "bg-red-600 border-red-600 text-white"
          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

export function ShopFilters() {
  const { filters, setFilters } = useShopStore();

  return (
    <div className="flex flex-wrap gap-2 items-center">
      <div className="flex gap-1.5">
        {SOURCES.map((s) => (
          <FilterPill
            key={s.value}
            active={filters.source === s.value}
            onClick={() => setFilters({ source: s.value })}
          >
            {s.label}
          </FilterPill>
        ))}
      </div>
      <div className="w-px h-4 bg-zinc-700" />
      <div className="flex gap-1.5">
        {PRICE_TYPES.map((p) => (
          <FilterPill
            key={p.value}
            active={filters.priceType === p.value}
            onClick={() => setFilters({ priceType: p.value })}
          >
            {p.label}
          </FilterPill>
        ))}
      </div>
    </div>
  );
}
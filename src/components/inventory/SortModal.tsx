// src/components/inventory/SortModal.tsx
import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import { useInventoryStore, SortField, SortDir } from "@/store/inventoryStore";
import { useT } from "../../i18n";

const SORT_OPTIONS = [
  { field: "date",   labelKey: "sort_date",   icon: "📅" },
  { field: "name",   labelKey: "sort_name",   icon: "🔤" },
  { field: "author", labelKey: "sort_author", icon: "👤" },
  { field: "size",   labelKey: "sort_size",   icon: "📦" },
  { field: "custom", labelKey: "sort_custom", icon: "✋" },
] as const;

interface SortDropdownProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function SortModal({ anchorRef, onClose }: SortDropdownProps) {
  const t = useT();
  const { sortField, sortDir, setSortField, setSortDir } = useInventoryStore();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Cierre al hacer click fuera
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  // Posición relativa al botón ancla
  const getPosition = () => {
    if (!anchorRef.current) return { top: 0, right: 0 };
    const rect = anchorRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    };
  };

  const pos = getPosition();

  const handleFieldClick = (field: SortField) => {
    if (field === sortField && field !== "custom") {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      if (field !== "custom") setSortDir("desc");
    }
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        position: "fixed",
        zIndex: 9999,
        top: pos.top,
        right: pos.right,
      }}
      className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl w-56 overflow-hidden
                 animate-in fade-in zoom-in-95 duration-100 origin-top-right"
    >
      <div className="p-1.5 flex flex-col gap-0.5">
        {SORT_OPTIONS.map(({ field, labelKey, icon }) => {
          const active = sortField === field;
          return (
            <button
              key={field}
              onClick={() => handleFieldClick(field)}
              className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-xs text-left transition-colors
                ${active
                  ? "bg-red-600/20 text-red-400 border border-red-600/30"
                  : "text-zinc-300 hover:bg-zinc-800 border border-transparent"
                }`}
            >
              <span className="text-sm leading-none">{icon}</span>
              <span className="flex-1">{t(labelKey)}</span>
              {active && field !== "custom" && (
                <span className="text-[10px] text-zinc-500 font-mono">
                  {sortDir === "asc" ? "↑" : "↓"}
                </span>
              )}
              {active && <Check className="h-3 w-3 text-red-400 shrink-0" />}
            </button>
          );
        })}
      </div>
      {sortField === "custom" && (
        <p className="px-3 pb-2.5 pt-0 text-[10px] text-zinc-600 leading-relaxed border-t border-zinc-800 mt-0.5 pt-2">
              {t("sort_custom_hint")}
        </p>
      )}
    </div>
  );
}
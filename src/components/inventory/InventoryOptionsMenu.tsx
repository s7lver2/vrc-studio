// src/components/inventory/InventoryOptionsMenu.tsx
import { MoreHorizontal, Tag, Shapes } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useAppearanceStore } from "@/store/appearanceStore";
import { useT } from "@/i18n";

export function InventoryOptionsMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { showTagsInGrid, setShowTagsInGrid, showTypeIcons, setShowTypeIcons } = useAppearanceStore();

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-9 w-9 flex items-center justify-center rounded-md border transition-colors
          ${open
            ? "bg-zinc-700 border-zinc-600 text-zinc-200"
            : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          }`}
        title={t("inventory_options_title")}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56
                        bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl
                        animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("inventory_options_show_in_grid")}</p>
          </div>
          <div className="p-1.5 flex flex-col gap-0.5">
            <ToggleRow
              icon={<Tag className="h-3.5 w-3.5" />}
              label={t("inventory_options_show_tags")}
              value={showTagsInGrid}
              onChange={setShowTagsInGrid}
            />
            <ToggleRow
              icon={<Shapes className="h-3.5 w-3.5" />}
              label={t("inventory_options_show_type_icons")}
              value={showTypeIcons}
              onChange={setShowTypeIcons}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  icon, label, value, onChange,
}: { icon: React.ReactNode; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm text-left
                 text-zinc-300 hover:bg-zinc-800 transition-colors"
    >
      <span className="text-zinc-500">{icon}</span>
      <span className="flex-1">{label}</span>
      {/* Toggle pill */}
      <div className={`w-8 h-4 rounded-full transition-colors relative ${value ? "bg-red-600" : "bg-zinc-700"}`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${value ? "left-4" : "left-0.5"}`} />
      </div>
    </button>
  );
}
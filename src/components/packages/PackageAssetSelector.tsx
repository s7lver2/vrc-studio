import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { InventoryItem } from "@/lib/tauri";

// NOTE: list_inventory_items command is not yet implemented in Rust (Fase 3).
// This component gracefully handles both an empty inventory and a missing command.
async function fetchInventoryItems(): Promise<InventoryItem[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<InventoryItem[]>("list_inventory_items");
  } catch {
    // Command not yet available — return empty list
    return [];
  }
}

interface PackageAssetSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function PackageAssetSelector({ selectedIds, onChange }: PackageAssetSelectorProps) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInventoryItems()
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  const filtered = items.filter(
    (item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      (item.author ?? "").toLowerCase().includes(query.toLowerCase())
  );

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (loading) {
    return (
      <p className="text-xs text-zinc-500 py-2">Cargando inventory…</p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-800/30 px-4 py-6 text-center">
        <p className="text-xs text-zinc-500">
          No hay assets en el Inventory todavía.
          <br />
          Descarga algunos en la sección{" "}
          <span className="text-zinc-400">Shop</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3">
      {/* Search */}
      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar asset…"
          className="w-full rounded-md border border-zinc-700 bg-zinc-800/50 py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
      </div>

      {/* List */}
      <div className="flex max-h-52 flex-col gap-1 overflow-y-auto pr-0.5">
        {filtered.length === 0 && (
          <p className="py-3 text-center text-xs text-zinc-600">Sin resultados.</p>
        )}
        {filtered.map((item) => (
          <label
            key={item.id}
            className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-zinc-800 transition-colors"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={() => toggle(item.id)}
              className="accent-red-600 h-3.5 w-3.5"
            />
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">{item.name}</p>
              {item.author && (
                <p className="truncate text-xs text-zinc-500">{item.author}</p>
              )}
            </div>
          </label>
        ))}
      </div>

      <p className="text-[10px] text-zinc-600">
        {selectedIds.length} asset{selectedIds.length !== 1 ? "s" : ""} seleccionado
        {selectedIds.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
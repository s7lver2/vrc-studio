// src/components/inventory/MultiSelectToolbar.tsx
import { Trash2, Archive, X, CheckSquare } from "lucide-react";
import { useInventoryStore } from "@/store/inventoryStore";
import { tauriDeleteInventoryItem, tauriCompressItem } from "@/lib/tauri";
import { useState, useCallback } from "react";
import { CompressionPopup } from "./CompressionPopup";

interface QueueState {
  items: { id: string; name: string }[];
  currentIdx: number;
}

export function MultiSelectToolbar() {
  const { selectedItemIds, clearSelection, items, fetchAll } = useInventoryStore();
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);

  const count = selectedItemIds.size;
  if (count === 0 && !queue) return null;

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar ${count} item${count > 1 ? "s" : ""}? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    try {
      await Promise.all(
        [...selectedItemIds].map((id) => tauriDeleteInventoryItem(id, "inventory_only"))
      );
      useInventoryStore.setState((s) => ({
        items: s.items.filter((i) => !selectedItemIds.has(i.id)),
        selectedItemIds: new Set(),
      }));
    } finally {
      setBusy(false);
    }
  };

  const handleCompress = async () => {
    const selectedItems = items
      .filter((i) => selectedItemIds.has(i.id) && !i.is_compressed)
      .map((i) => ({ id: i.id, name: i.display_name ?? i.name }));

    if (selectedItems.length === 0) return;
    setBusy(true);

    const q: QueueState = { items: selectedItems, currentIdx: 0 };
    setQueue(q);
    // Arrancar la primera compresión
    tauriCompressItem(selectedItems[0].id).catch(console.error);
  };

  const handleItemDone = useCallback(() => {
    setQueue((prev) => {
      if (!prev) return null;
      const nextIdx = prev.currentIdx + 1;
      if (nextIdx < prev.items.length) {
        // Arrancar la siguiente compresión
        tauriCompressItem(prev.items[nextIdx].id).catch(console.error);
        return { ...prev, currentIdx: nextIdx };
      }
      // Cola completa
      return null;
    });

    // Cuando la cola termina (queue pasa a null en el próximo render)
    // limpiamos y recargamos
    setQueue((current) => {
      if (current === null) {
        fetchAll();
        clearSelection();
        setBusy(false);
      }
      return current;
    });
  }, [fetchAll, clearSelection]);

  const handleQueueError = useCallback((msg: string) => {
    console.error("Compression error:", msg);
    // Avanzar igualmente al siguiente item
    handleItemDone();
  }, [handleItemDone]);

  const currentQueueItem = queue ? queue.items[queue.currentIdx] : null;

  return (
    <>
      {count > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                        flex items-center gap-2 px-4 py-2.5
                        bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl
                        animate-in slide-in-from-bottom-4 duration-200">
          <CheckSquare className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-zinc-200 mr-1">{count} seleccionados</span>

          <div className="w-px h-5 bg-zinc-700" />

          <button
            disabled={busy}
            onClick={handleCompress}
            className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" />
            Comprimir
          </button>

          <button
            disabled={busy}
            onClick={handleDelete}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg hover:bg-red-950/40 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar
          </button>

          <div className="w-px h-5 bg-zinc-700" />

          <button
            onClick={clearSelection}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Popup de compresión con cola */}
      {queue && currentQueueItem && (
        <CompressionPopup
          key={currentQueueItem.id}
          itemId={currentQueueItem.id}
          itemName={currentQueueItem.name}
          mode="compress"
          onDone={handleItemDone}
          onError={handleQueueError}
          queueCurrent={queue.currentIdx + 1}
          queueTotal={queue.items.length}
        />
      )}
    </>
  );
}
import { Trash2, Archive, X, CheckSquare, RefreshCw } from "lucide-react";
import { useInventoryStore } from "@/store/inventoryStore";
import { tauriDeleteInventoryItem, tauriCompressItem } from "@/lib/tauri";
import { useState, useCallback, useEffect, useRef } from "react";
import { CompressionPopup } from "./CompressionPopup";
import { OpenInUnityModal } from "./OpenInUnityModal";
import { ExternalLink } from "lucide-react";
import { useT } from "../../i18n";

interface QueueState {
  items: { id: string; name: string }[];
  currentIdx: number;
}

export function MultiSelectToolbar() {
  const t = useT();
  const { selectedItemIds, clearSelection, items, fetchAll } = useInventoryStore();
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [showOpenInUnity, setShowOpenInUnity] = useState(false);
  const selectedItems = items.filter((i) => selectedItemIds.has(i.id));
  // Ref para saber si el queue session está activa (evita doble disparo en StrictMode)
  const compressionFiredRef = useRef<string | null>(null);

  const count = selectedItemIds.size;

  const handleDelete = useCallback(async () => {
    if (!confirm(t("multiselect_delete_confirm", { count: count }))) return;
    setBusy(true);
    try {
      await Promise.all([...selectedItemIds].map((id) => tauriDeleteInventoryItem(id, "InventoryOnly")));
      useInventoryStore.setState((s) => ({
        items: s.items.filter((i) => !selectedItemIds.has(i.id)),
        selectedItemIds: new Set(),
      }));
      clearSelection();
    } finally {
      setBusy(false);
    }
  }, [selectedItemIds, count, clearSelection]);

  const handleCompress = useCallback(async () => {
    const selectedItems = items
      .filter((i) => selectedItemIds.has(i.id) && !i.is_compressed)
      .map((i) => ({ id: i.id, name: i.display_name ?? i.name }));

    if (selectedItems.length === 0) return;
    setBusy(true);
    compressionFiredRef.current = null;
    // Solo fijamos la cola — el useEffect de abajo dispara la compresión
    setQueue({ items: selectedItems, currentIdx: 0 });
  }, [items, selectedItemIds]);

  // ── Disparar compresión cuando el índice de la cola cambia ────────────────
  // Esto está fuera del setQueue functional updater, así no se llama dos veces
  // en React StrictMode.
  useEffect(() => {
    if (!queue) return;
    const currentItem = queue.items[queue.currentIdx];
    if (!currentItem) return;
    // Guard anti-doble disparo (StrictMode monta el efecto dos veces)
    if (compressionFiredRef.current === currentItem.id) return;
    compressionFiredRef.current = currentItem.id;
    tauriCompressItem(currentItem.id).catch(console.error);
  }, [queue?.currentIdx, queue !== null]);
  // Nota: dependencia en `queue !== null` garantiza que el efecto se dispara
  // cuando la cola se crea por primera vez (currentIdx=0).

  // ── Cleanup cuando la cola termina ───────────────────────────────────────
  useEffect(() => {
    if (!busy) return;         // No hay sesión activa
    if (queue !== null) return; // La cola sigue en marcha
    // queue es null Y busy es true → la cola acaba de terminar
    fetchAll();
    clearSelection();
    setBusy(false);
    compressionFiredRef.current = null;
  }, [queue, busy, fetchAll, clearSelection]);

  // ── Callbacks del popup ──────────────────────────────────────────────────
  const handleItemDone = useCallback(() => {
    setQueue((prev) => {
      if (!prev) return null;
      const nextIdx = prev.currentIdx + 1;
      if (nextIdx >= prev.items.length) return null; // cola terminada
      return { ...prev, currentIdx: nextIdx };
    });
    // No llamar clearSelection/fetchAll aquí — lo hace el useEffect de cleanup
  }, []);

  const handleQueueError = useCallback((msg: string) => {
    console.error("Compression error:", msg);
    handleItemDone(); // skip failed item, advance to next
  }, [handleItemDone]);

  const currentQueueItem = queue ? queue.items[queue.currentIdx] : null;

  if (count === 0 && !queue) return null;

  return (
    <>
      {count > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
          <CheckSquare className="h-4 w-4 text-red-400" />
          <span className="text-sm font-semibold text-zinc-200 mr-1">{count} {t("multiselect_selected")}</span>
          <div className="w-px h-5 bg-zinc-700" />
          <button disabled={busy} onClick={handleCompress} className="flex items-center gap-1.5 text-xs text-zinc-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50">
            <Archive className="h-3.5 w-3.5" /> {t("multiselect_compress")}
          </button>
          <button disabled={busy} onClick={() => setShowOpenInUnity(true)}
            className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-200 px-2.5 py-1.5 rounded-lg hover:bg-violet-950/40 transition-colors disabled:opacity-50">
            <ExternalLink className="h-3.5 w-3.5" /> {t("multiselect_open_in_unity")}
          </button>
          <button disabled={busy} onClick={handleDelete} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg hover:bg-red-950/40 transition-colors disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> {t("multiselect_delete")}
          </button>
          <div className="w-px h-5 bg-zinc-700" />
          <button onClick={clearSelection} className="text-zinc-500 hover:text-zinc-300 p-1 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
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
      {showOpenInUnity && (
        <OpenInUnityModal
          items={selectedItems}
          onClose={() => setShowOpenInUnity(false)}
        />
      )}
    </>
  );
}
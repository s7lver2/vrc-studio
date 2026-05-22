import { useState, useEffect } from "react";
import { X, Plus, Trash2, Edit2, Check, Image, Folder, ArrowLeft, Download } from "lucide-react";
import { useCollectionsStore } from "../../store/collectionsStore";
import { CollectionItem } from "../../lib/tauri";
import { tauriStartDownload } from "../../lib/tauri";

interface CollectionsViewProps {
  onClose: () => void;
}

export function CollectionsView({ onClose }: CollectionsViewProps) {
  const {
    collections,
    createCollection,
    deleteCollection,
    renameCollection,
    setCover,
    getCollectionItems,
    removeItemFromCollection,
  } = useCollectionsStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const selectedCollection = collections.find((c) => c.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingItems(true);
    getCollectionItems(selectedId)
      .then(setItems)
      .finally(() => setLoadingItems(false));
  }, [selectedId]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCollection(newName.trim());
    setNewName("");
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) return;
    await renameCollection(id, editingName.trim());
    setEditingId(null);
  };

  const handleSetCoverFromItem = async (collectionId: string, thumbnailUrl: string) => {
    await setCover(collectionId, thumbnailUrl);
  };

  const handleRemoveItem = async (item: CollectionItem) => {
    if (!selectedId) return;
    await removeItemFromCollection(selectedId, item.source, item.source_id);
    setItems((s) => s.filter((i) => i.id !== item.id));
  };

  const handleDownloadItem = async (item: CollectionItem) => {
    try {
      await tauriStartDownload({
        source: item.source,
        source_id: item.source_id,
        name: item.name,
        author: item.author,
        thumbnail_url: item.thumbnail_url,
      });
    } catch (e) {
      console.error("Download error:", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-zinc-950/70 backdrop-blur-sm">
      <div
        className="flex-1"
        onClick={onClose}
      />
      <div className="w-[420px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          {selectedId ? (
            <button onClick={() => setSelectedId(null)} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
              <X className="h-4 w-4" />
            </button>
          )}
          <span className="text-sm font-semibold text-zinc-100">
            {selectedCollection ? selectedCollection.name : "Collections"}
          </span>
        </div>

        {/* Content */}
        {!selectedId ? (
          // ── Lista de colecciones ──────────────────────────────────────────
          <>
            <div className="flex-1 overflow-y-auto">
              {collections.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-2">
                  <Folder className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No collections yet</p>
                </div>
              )}
              <ul className="divide-y divide-zinc-800">
                {collections.map((col) => (
                  <li key={col.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 group">
                    {/* Cover */}
                    <button
                      onClick={() => setSelectedId(col.id)}
                      className="shrink-0"
                    >
                      {col.cover_url ? (
                        <img src={col.cover_url} alt="" className="w-12 h-12 rounded-md object-cover bg-zinc-800" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-zinc-800 flex items-center justify-center">
                          <Folder className="h-5 w-5 text-zinc-600" />
                        </div>
                      )}
                    </button>

                    {/* Name / edit */}
                    <div className="flex-1 min-w-0" onClick={() => setSelectedId(col.id)}>
                      {editingId === col.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            className="flex-1 text-sm bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-zinc-200 outline-none"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleRename(col.id); if (e.key === "Escape") setEditingId(null); }}
                          />
                          <button onClick={() => handleRename(col.id)} className="p-1 text-emerald-400 hover:bg-emerald-500/10 rounded">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-zinc-200 truncate">{col.name}</p>
                          <p className="text-xs text-zinc-500">{col.item_count} items</p>
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditingId(col.id); setEditingName(col.name); }}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                        title="Rename"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => deleteCollection(col.id)}
                        className="p-1 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-400"
                        title="Delete collection"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Create new collection */}
            <div className="border-t border-zinc-800 p-3 flex gap-2">
              <input
                className="flex-1 px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-md text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                placeholder="New collection name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="p-1.5 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          // ── Items de una colección ────────────────────────────────────────
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {loadingItems ? (
                <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">Loading…</div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-2">
                  <p className="text-sm">No items in this collection</p>
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 group">
                      {item.thumbnail_url ? (
                        <img src={item.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover bg-zinc-800 shrink-0" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-10 h-10 rounded bg-zinc-800 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-200 truncate">{item.name}</p>
                        <p className="text-[10px] text-zinc-500">{item.author}</p>
                        <p className="text-[10px] text-red-400 font-semibold">{item.price_display}</p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleSetCoverFromItem(selectedId, item.thumbnail_url)}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                          title="Set as collection cover"
                        >
                          <Image className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownloadItem(item)}
                          className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveItem(item)}
                          className="p-1 rounded hover:bg-red-500/10 text-zinc-500 hover:text-red-400"
                          title="Remove from collection"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
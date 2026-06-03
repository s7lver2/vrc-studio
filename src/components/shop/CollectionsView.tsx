import { useState, useEffect } from "react";
import {
  X, Plus, Trash2, Edit2, Check, Image, Folder,
  ArrowLeft, Download, FileText, BookmarkX, Package2,
} from "lucide-react";
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
    updateDescription,
  } = useCollectionsStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [coverInputId, setCoverInputId] = useState<string | null>(null);
  const [coverInputValue, setCoverInputValue] = useState("");
  const [descEditingId, setDescEditingId] = useState<string | null>(null);
  const [descEditingValue, setDescEditingValue] = useState("");

  const selectedCollection = collections.find((c) => c.id === selectedId);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingItems(true);
    getCollectionItems(selectedId)
      .then(setItems)
      .finally(() => setLoadingItems(false));
  }, [selectedId, getCollectionItems]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCollection(newName.trim());
    setNewName("");
  };

  const handleSetCustomCover = async (id: string) => {
    const url = coverInputValue.trim();
    if (!url) return;
    await setCover(id, url);
    setCoverInputId(null);
    setCoverInputValue("");
  };

  const handleSaveDescription = async (id: string) => {
    await updateDescription(id, descEditingValue.trim());
    setDescEditingId(null);
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
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-zinc-950/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="w-[400px] bg-zinc-950 border-l border-zinc-800/80 flex flex-col h-full shadow-2xl shadow-black/60">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800/80 shrink-0">
          {selectedId ? (
            <button
              onClick={() => setSelectedId(null)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">
              {selectedCollection ? selectedCollection.name : "Collections"}
            </p>
            {selectedCollection && (
              <p className="text-[10px] text-zinc-600 mt-0.5">
                {items.length} item{items.length !== 1 ? "s" : ""}
                {selectedCollection.description && (
                  <span className="ml-1">· {selectedCollection.description.slice(0, 40)}{selectedCollection.description.length > 40 ? "…" : ""}</span>
                )}
              </p>
            )}
            {!selectedCollection && (
              <p className="text-[10px] text-zinc-600 mt-0.5">{collections.length} collection{collections.length !== 1 ? "s" : ""}</p>
            )}
          </div>
        </div>

        {/* ── Content ────────────────────────────────────────────────────── */}
        {!selectedId ? (
          <>
            {/* Collection list */}
            <div className="flex-1 overflow-y-auto">
              {collections.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-4 text-center px-6">
                  <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5">
                    <Folder className="h-8 w-8 text-zinc-700 mx-auto" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-400">No collections yet</p>
                    <p className="text-xs text-zinc-600 mt-1">Create one below to save items from the shop</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 flex flex-col gap-1.5">
                  {collections.map((col) => (
                    <div key={col.id} className="group rounded-xl border border-zinc-800/80 bg-zinc-900/60 overflow-hidden hover:border-zinc-700/60 transition-colors">
                      {/* Main row */}
                      <div
                        className="flex items-center gap-3 p-3 cursor-pointer"
                        onClick={() => setSelectedId(col.id)}
                      >
                        {/* Cover */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCoverInputId(coverInputId === col.id ? null : col.id);
                            setCoverInputValue(col.cover_url || "");
                          }}
                          className="relative shrink-0 rounded-lg overflow-hidden"
                          title="Change cover"
                        >
                          {col.cover_url ? (
                            <img
                              src={col.cover_url}
                              alt=""
                              className="w-12 h-12 object-cover bg-zinc-800"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-12 h-12 bg-zinc-800 flex items-center justify-center">
                              <Folder className="h-5 w-5 text-zinc-600" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-zinc-900/70 opacity-0 hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Image className="h-3.5 w-3.5 text-zinc-300" />
                          </div>
                        </button>

                        {/* Name / edit */}
                        <div className="flex-1 min-w-0">
                          {editingId === col.id ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <input
                                autoFocus
                                className="flex-1 text-sm bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1 text-zinc-200 outline-none focus:border-zinc-400"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleRename(col.id);
                                  if (e.key === "Escape") setEditingId(null);
                                }}
                              />
                              <button
                                onClick={() => handleRename(col.id)}
                                className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-semibold text-zinc-200 truncate">{col.name}</p>
                              <p className="text-[11px] text-zinc-500 mt-0.5">
                                <span className="text-zinc-400 font-medium">{col.item_count}</span> item{col.item_count !== 1 ? "s" : ""}
                                {col.description && (
                                  <span className="text-zinc-600 ml-1.5">
                                    · {col.description.slice(0, 32)}{col.description.length > 32 ? "…" : ""}
                                  </span>
                                )}
                              </p>
                            </>
                          )}
                        </div>

                        {/* Actions */}
                        <div
                          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setEditingId(col.id); setEditingName(col.name); }}
                            className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Rename"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setDescEditingId(descEditingId === col.id ? null : col.id);
                              setDescEditingValue(col.description ?? "");
                            }}
                            className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
                            title="Edit description"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteCollection(col.id)}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
                            title="Delete collection"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Cover URL input */}
                      {coverInputId === col.id && (
                        <div className="flex items-center gap-2 px-3 pb-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            className="flex-1 px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                            placeholder="Cover image URL (https://…)"
                            value={coverInputValue}
                            onChange={(e) => setCoverInputValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSetCustomCover(col.id);
                              if (e.key === "Escape") setCoverInputId(null);
                            }}
                          />
                          <button
                            onClick={() => handleSetCustomCover(col.id)}
                            disabled={!coverInputValue.trim()}
                            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
                          >
                            Set
                          </button>
                        </div>
                      )}

                      {/* Description editor */}
                      {descEditingId === col.id && (
                        <div className="flex items-center gap-2 px-3 pb-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            className="flex-1 px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500"
                            placeholder="Description (optional)"
                            value={descEditingValue}
                            onChange={(e) => setDescEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveDescription(col.id);
                              if (e.key === "Escape") setDescEditingId(null);
                            }}
                          />
                          <button
                            onClick={() => handleSaveDescription(col.id)}
                            className="p-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Create new collection */}
            <div className="border-t border-zinc-800/80 p-4 shrink-0">
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 text-sm bg-zinc-900 border border-zinc-700/60 rounded-xl text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                  placeholder="New collection name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white transition-colors flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ── Items de una colección ─────────────────────────────────── */
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex-1 overflow-y-auto">
              {loadingItems ? (
                <div className="flex items-center justify-center h-32 text-zinc-600 text-sm">Loading…</div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 gap-4 text-center px-6">
                  <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5">
                    <Package2 className="h-8 w-8 text-zinc-700 mx-auto" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-400">No items yet</p>
                    <p className="text-xs text-zinc-600 mt-1">Bookmark products from the shop to add them here</p>
                  </div>
                </div>
              ) : (
                <div className="p-3 flex flex-col gap-1.5">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center gap-3 p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700/60 transition-colors"
                    >
                      {/* Thumbnail */}
                      {item.thumbnail_url ? (
                        <img
                          src={item.thumbnail_url}
                          alt=""
                          className="w-11 h-11 rounded-lg object-cover bg-zinc-800 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-lg bg-zinc-800 shrink-0 flex items-center justify-center">
                          <Package2 className="h-4 w-4 text-zinc-600" />
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-200 truncate">{item.name}</p>
                        <p className="text-[10px] text-zinc-500 truncate">{item.author}</p>
                        <p className="text-[10px] font-bold text-red-400 mt-0.5">{item.price_display}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleSetCoverFromItem(selectedId, item.thumbnail_url)}
                          className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
                          title="Set as collection cover"
                        >
                          <Image className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDownloadItem(item)}
                          className="p-1.5 rounded-lg hover:bg-zinc-700 text-zinc-600 hover:text-blue-300 transition-colors"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveItem(item)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
                          title="Remove from collection"
                        >
                          <BookmarkX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

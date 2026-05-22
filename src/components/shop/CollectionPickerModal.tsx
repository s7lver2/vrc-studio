// src/components/shop/CollectionPickerModal.tsx
import { useState, useEffect } from "react";
import { X, Plus, Check, FolderPlus, Folder } from "lucide-react";
import { useCollectionsStore } from "../../store/collectionsStore";

export function CollectionPickerModal() {
  const {
    collections,
    pickerOpen,
    pickerProduct,
    closePicker,
    addItemToCollection,
    removeItemFromCollection,
    createCollection,
    getItemCollectionIds,
  } = useCollectionsStore();

  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!pickerOpen || !pickerProduct) return;
    getItemCollectionIds(pickerProduct.source, pickerProduct.source_id).then(
      (ids) => setMemberIds(new Set(ids))
    );
  }, [pickerOpen, pickerProduct?.source_id]);

  if (!pickerOpen || !pickerProduct) return null;

  const handleToggle = async (collectionId: string) => {
    setPending(collectionId);
    try {
      if (memberIds.has(collectionId)) {
        await removeItemFromCollection(collectionId, pickerProduct.source, pickerProduct.source_id);
        setMemberIds((s) => { const n = new Set(s); n.delete(collectionId); return n; });
      } else {
        await addItemToCollection(collectionId, pickerProduct);
        setMemberIds((s) => new Set([...s, collectionId]));
      }
    } finally {
      setPending(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const col = await createCollection(newName.trim());
      await addItemToCollection(col.id, pickerProduct);
      setMemberIds((s) => new Set([...s, col.id]));
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
      <div className="relative w-80 max-h-[70vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-100">Save to collection</span>
          <button onClick={closePicker} className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Product preview */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800 bg-zinc-800/40">
          {pickerProduct.thumbnail_url && (
            <img src={pickerProduct.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover bg-zinc-700" referrerPolicy="no-referrer" />
          )}
          <p className="text-xs text-zinc-300 truncate flex-1">{pickerProduct.name}</p>
        </div>

        {/* Collections list */}
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-800">
          {collections.length === 0 && (
            <p className="text-xs text-zinc-500 text-center py-6">No collections yet</p>
          )}
          {collections.map((col) => {
            const isMember = memberIds.has(col.id);
            const isLoading = pending === col.id;
            return (
              <button
                key={col.id}
                onClick={() => handleToggle(col.id)}
                disabled={isLoading}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/50 transition-colors"
              >
                {col.cover_url ? (
                  <img src={col.cover_url} alt="" className="w-8 h-8 rounded object-cover bg-zinc-800 shrink-0" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center shrink-0">
                    <Folder className="h-4 w-4 text-zinc-500" />
                  </div>
                )}
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{col.name}</p>
                  <p className="text-xs text-zinc-500">{col.item_count} items</p>
                </div>
                <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  isMember
                    ? "bg-red-600 border-red-600 text-white"
                    : "border-zinc-600"
                }`}>
                  {isMember && <Check className="h-3 w-3" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* New collection input */}
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
            disabled={creating || !newName.trim()}
            className="p-1.5 rounded-md bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white transition-colors"
            title="Create and add"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
// src/components/shop/CollectionsModal.tsx
import { useState, useEffect, useCallback, useRef } from "react";

/** Returns true if `ancestorId` is an ancestor of `colId` in the collection tree. */
function isDescendant(collections: { id: string; parent_id: string | null }[], colId: string, ancestorId: string): boolean {
  let current: string | null = ancestorId;
  const visited = new Set<string>();
  while (current !== null) {
    if (visited.has(current)) break; // cycle already exists — stop
    visited.add(current);
    if (current === colId) return true;
    const parent = collections.find((c) => c.id === current)?.parent_id ?? null;
    current = parent;
  }
  return false;
}
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  DragOverlay, pointerWithin, useSensor, useSensors, PointerSensor,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { X } from "lucide-react";
import { useCollectionsStore } from "../../store/collectionsStore";
import { CollectionTree } from "./CollectionTree";
import { CollectionItemsGrid, ItemDragGhost } from "./CollectionItemsGrid";
import type { CollectionItem } from "../../lib/tauri";

// Prioritize col: and root targets over item: targets (same as inventory pattern)
const collectionFirstCollision = (args: Parameters<typeof pointerWithin>[0]) => {
  const collisions = pointerWithin(args);
  const colHits  = collisions.filter((c) => String(c.id).startsWith("col:") || c.id === "root");
  const itemHits = collisions.filter((c) => String(c.id).startsWith("item:"));
  return [...colHits, ...itemHits];
};

interface Props {
  onClose: () => void;
}

export function CollectionsModal({ onClose }: Props) {
  const {
    collections,
    createCollection,
    setCover,
    removeItemFromCollection,
    getCollectionItems,
    moveCollectionToParent,
    reorderCollections,
    reorderItems,
    moveItem,
  } = useCollectionsStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const localOrderRef = useRef<string[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Keep ref in sync with localOrder
  useEffect(() => {
    localOrderRef.current = localOrder;
  }, [localOrder]);

  // Load items when selected collection changes
  useEffect(() => {
    if (!selectedId) { setItems([]); setLocalOrder([]); return; }
    let cancelled = false;
    setLoading(true);
    getCollectionItems(selectedId)
      .then((loaded) => {
        if (cancelled) return;
        setItems(loaded);
        setLocalOrder(loaded.map((i) => `item:${i.id}`));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId, getCollectionItems]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── DnD handlers ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const handleDragOver = useCallback((e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const aid = String(active.id);
    const oid = String(over.id);

    // Optimistic reorder of items within grid
    if (aid.startsWith("item:") && oid.startsWith("item:")) {
      setLocalOrder((prev) => {
        const oldIdx = prev.indexOf(aid);
        const newIdx = prev.indexOf(oid);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;

    const aid = String(active.id);
    const oid = String(over.id);

    // ── Item drag ────────────────────────────────────────────────────────────
    if (aid.startsWith("item:")) {
      const itemId = aid.replace("item:", "");

      if (oid.startsWith("col:") && selectedId) {
        // Move item to another collection
        const targetColId = oid.replace("col:", "");
        if (targetColId !== selectedId) {
          await moveItem(itemId, selectedId, targetColId);
          setItems((prev) => prev.filter((i) => i.id !== itemId));
          setLocalOrder((prev) => prev.filter((id) => id !== aid));
        }
      } else if (oid.startsWith("item:") && selectedId) {
        // Persist reorder
        await reorderItems(selectedId, localOrderRef.current.map((id) => id.replace("item:", "")));
      }
      return;
    }

    // ── Collection drag ──────────────────────────────────────────────────────
    if (aid.startsWith("col:")) {
      const colId = aid.replace("col:", "");

      if (oid === "root") {
        await moveCollectionToParent(colId, null);
        return;
      }

      if (oid.startsWith("col:")) {
        const targetColId = oid.replace("col:", "");
        if (targetColId === colId) return;

        const sourceCol = collections.find((c) => c.id === colId);
        const targetCol = collections.find((c) => c.id === targetColId);
        if (!sourceCol || !targetCol) return;

        if (sourceCol.parent_id === targetCol.parent_id) {
          // Same level → reorder
          const sameLevel = collections
            .filter((c) => c.parent_id === sourceCol.parent_id)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((c) => c.id);
          const oldIdx = sameLevel.indexOf(colId);
          const newIdx = sameLevel.indexOf(targetColId);
          if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
            await reorderCollections(arrayMove(sameLevel, oldIdx, newIdx));
          }
        } else {
          // Different level → nest under targetCol (guard against cycles)
          if (!isDescendant(collections, targetColId, colId)) {
            await moveCollectionToParent(colId, targetColId);
          }
        }
      }
    }
  }, [selectedId, collections, moveItem, reorderItems, moveCollectionToParent, reorderCollections]);

  // ── UI helpers ───────────────────────────────────────────────────────────

  const handleSetCover = async (url: string) => {
    if (!selectedId) return;
    await setCover(selectedId, url);
  };

  const handleRemoveItem = async (item: CollectionItem) => {
    if (!selectedId) return;
    await removeItemFromCollection(selectedId, item.source, item.source_id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    setLocalOrder((prev) => prev.filter((id) => id !== `item:${item.id}`));
  };

  const handleCreateCollection = async (name: string) => {
    await createCollection(name);
  };

  // Active item for DragOverlay
  const activeItem = activeId?.startsWith("item:")
    ? items.find((i) => i.id === activeId.replace("item:", ""))
    : null;

  const selectedCollection = collections.find((c) => c.id === selectedId);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Modal shell */}
      <div
        className="relative flex flex-col bg-zinc-950 border border-zinc-800/80 rounded-2xl shadow-2xl shadow-black/60 overflow-hidden"
        style={{ width: "min(1100px, 92vw)", height: "min(680px, 88vh)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-950 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-zinc-100">
              {selectedCollection ? selectedCollection.name : "Colecciones"}
            </p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {selectedCollection
                ? `${selectedCollection.item_count} item${selectedCollection.item_count !== 1 ? "s" : ""}`
                : `${collections.length} colección${collections.length !== 1 ? "es" : ""}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body: two panels ─────────────────────────────────────────────── */}
        <DndContext
          sensors={sensors}
          collisionDetection={collectionFirstCollision}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left — collection tree */}
            <div className="w-[220px] shrink-0 border-r border-zinc-800/60 bg-zinc-950 overflow-hidden">
              <CollectionTree
                collections={collections}
                selectedId={selectedId}
                activeId={activeId}
                onSelect={setSelectedId}
                onCreateCollection={handleCreateCollection}
              />
            </div>

            {/* Right — items grid */}
            <div className="flex-1 overflow-hidden flex flex-col min-w-0">
              <CollectionItemsGrid
                collectionId={selectedId}
                items={items}
                loading={loading}
                localOrder={localOrder}
                onSetCover={handleSetCover}
                onRemove={handleRemoveItem}
              />
            </div>
          </div>

          {/* DragOverlay */}
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            {activeItem && <ItemDragGhost item={activeItem} />}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

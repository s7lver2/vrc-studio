// src/components/inventory/InventoryGrid.tsx
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  pointerWithin, useSensor, useSensors, PointerSensor,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, arrayMove, useSortable
} from "@dnd-kit/sortable";
import { Loader2 } from "lucide-react";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useInventoryStore } from "@/store/inventoryStore";
import { InventoryItemCard } from "./InventoryItemCard";
import { FolderCard, GoUpZone } from "./FolderCard";
import { useAppearanceStore } from "@/store/appearanceStore";
import { GridContextMenu } from "./GridContextMenu";
import { useT } from "@/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { preloadImage } from "@/lib/imageCache";
import { CSS } from "@dnd-kit/utilities";
import type { InventoryFolder } from "@/lib/tauri";

interface InventoryGridProps {
  tagFilter?: string | null;
  searchQuery?: string;
}

// Custom collision detection
const folderFirstCollision = (args: any) => {
  const { pointerCoordinates } = args;
  if (!pointerCoordinates) return [];
  const collisions = pointerWithin(args);
  const folderCollisions = collisions.filter(
    (c) => c.id.toString().startsWith("folder:") || c.id.toString() === "root"
  );
  const otherCollisions = collisions.filter(
    (c) => !c.id.toString().startsWith("folder:") && c.id.toString() !== "root"
  );
  return [...folderCollisions, ...otherCollisions];
};

function SortableFolderCard({
  folder,
  itemCount,
  onOpen,
  isDragging: parentIsDragging,
}: {
  folder: InventoryFolder;
  itemCount: number;
  onOpen: (id: string) => void;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `folder-${folder.id}`,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <FolderCard
        folder={folder}
        itemCount={itemCount}
        onOpen={onOpen}
        isDragging={parentIsDragging || isDragging}
        viewMode="grid"
      />
    </div>
  );
}

export function InventoryGrid({ tagFilter, searchQuery = "" }: InventoryGridProps = {}) {
  const t = useT();
  const inventoryItemSize = useAppearanceStore((s) => s.inventoryItemSize);
  const {
    // Store functions and state
    filteredItems: storeFilteredItems, // function, not array
    loading,
    error,
    selectedFolderId,
    selectFolder,
    folders,
    moveItem,
    moveFolderToParent,
    reorderItems,
    reorderFolders,
    sortField,
    selectedItemIds,
    toggleSelectItem,
    rangeSelectItems,
    lastSelectedId,
    viewMode,
  } = useInventoryStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number } | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const pendingOrderRef = useRef<string[] | null>(null);


  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const sensors = useSensors(pointerSensor);

  const debouncedSearch = useDebouncedValue(searchQuery, 200);

  // Get base items from store (already filtered by folder and custom filters inside store)
  const baseItems = storeFilteredItems();

  // Apply tag filter and search on top of storeFilteredItems
  const visibleItems = useMemo(() => {
    let items = baseItems;
    if (tagFilter) {
      items = items.filter((i) => i.tags.includes(tagFilter));
    }
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.display_name ?? "").toLowerCase().includes(q) ||
          (i.author ?? "").toLowerCase().includes(q)
      );
    }
    return items;
  }, [baseItems, tagFilter, debouncedSearch]);

  // Folders inside current directory
  const currentFolders = useMemo(() => {
    return folders.filter((f) => f.parent_id === (selectedFolderId ?? null));
  }, [folders, selectedFolderId]);

  // Count items inside a folder (optional, can be left as 0)
  const folderItemCounts = useCallback((folderId: string): number => {
    // If you need real counts, implement using baseItems or a separate store query
    return 0;
  }, []);

  // Custom order for grid sorting (only when sortField === "custom")
  const displayOrder = useMemo(() => {
    return localOrder ?? visibleItems.map((i) => i.id);
  }, [localOrder, visibleItems]);

  // Card size mapping for auto-fill grid — fixed range so cards don't stretch
  const cardSizes: Record<"compact" | "normal" | "large", { min: number; max: number }> = {
    compact: { min: 140, max: 164 },
    normal: { min: 180, max: 210 },
    large: { min: 220, max: 256 },
  };
  const { min: minCardWidth, max: maxCardWidth } = cardSizes[inventoryItemSize];

  const sortedItems = useMemo(() => {
    return displayOrder
      .map((id) => visibleItems.find((i) => i.id === id))
      .filter(Boolean) as typeof visibleItems;
  }, [displayOrder, visibleItems]);

  // Pre-load thumbnails for visible items so they render instantly
  useEffect(() => {
    for (const item of visibleItems.slice(0, 80)) {
      if (item.thumbnail_url) preloadImage(item.thumbnail_url);
      for (const url of item.product_images ?? []) {
        if (url) preloadImage(url);
      }
    }
  }, [visibleItems]);

  // DnD handlers
  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveId(String(event.active.id));
      if (!localOrder) setLocalOrder(visibleItems.map((i) => i.id));
    },
    [visibleItems, localOrder]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!localOrder) return;
      const { active, over } = event;
      if (!over) return;
      const overId = String(over.id);
      if (overId.startsWith("folder:") || overId === "root") return;

      const oldIdx = localOrder.indexOf(String(active.id));
      const newIdx = localOrder.indexOf(overId);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        const newOrder = arrayMove(localOrder, oldIdx, newIdx);
        pendingOrderRef.current = newOrder;

        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            if (pendingOrderRef.current) {
              setLocalOrder(pendingOrderRef.current);
              pendingOrderRef.current = null;
            }
          });
        }
      }
    },
    [localOrder]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      // Cancelar raf pendiente si existe
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        pendingOrderRef.current = null;
      }

      const { active, over } = event;
      setActiveId(null);
      if (!over) {
        setLocalOrder(null);
        return;
      }

      const rawActiveId = String(active.id);
      const targetId = String(over.id);

      // ── Folder being dragged ─────────────────────────────────────────────
      if (rawActiveId.startsWith("folder-")) {
        const sourceFolderId = rawActiveId.replace("folder-", "");
        if (targetId.startsWith("folder:")) {
          // Dropped onto another folder — make it a child
          const destFolderId = targetId.replace("folder:", "");
          if (destFolderId !== sourceFolderId) {
            await moveFolderToParent(sourceFolderId, destFolderId);
          }
        } else if (targetId === "root") {
          // Dropped on "go up" zone — move to root
          await moveFolderToParent(sourceFolderId, null);
        }
        // else: reorder among sibling folders — handled by existing reorderFolders logic below
        setLocalOrder(null);
        return;
      }

      // ── Inventory item being dragged ─────────────────────────────────────
      const itemId = rawActiveId;
      if (targetId.startsWith("folder:")) {
        const folderId = targetId.replace("folder:", "");
        await moveItem(itemId, folderId);
        setLocalOrder(null);
        return;
      }
      if (targetId === "root" && selectedFolderId) {
        await moveItem(itemId, "__root__");
        setLocalOrder(null);
        return;
      }
      // ── PERSISTIR ORDEN MANUAL ──
      if (localOrder) {
        // Cambiar a orden personalizada para que no se reordene por fecha/nombre
        useInventoryStore.getState().setSortField("custom");
        await reorderItems(localOrder);
      }
      setLocalOrder(null);
    },
    [moveItem, moveFolderToParent, selectedFolderId, localOrder, sortField, reorderItems]
  );

  const handleGridContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setGridMenu({ x: e.clientX, y: e.clientY });
  };

  // Virtual list for list view
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  // Loading / error / empty states
  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 h-48">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center flex-1 h-48 text-red-400 text-sm">
        {error}
      </div>
    );
  }
  if (visibleItems.length === 0 && currentFolders.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 h-48 text-zinc-500 text-sm">
        {t("inventory_no_items")}
      </div>
    );
  }

  // LIST MODE (virtualized, no DnD for items)
  if (viewMode === "list") {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={folderFirstCollision}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          className="relative flex-1 flex flex-col gap-3"
          onContextMenu={handleGridContextMenu}
          ref={gridContainerRef}
          style={{ willChange: 'transform', contain: 'layout style' }}
        >
          {selectedFolderId && <GoUpZone isDragging={activeId !== null} />}
          {currentFolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              itemCount={folderItemCounts(folder.id)}
              onOpen={(id) => selectFolder(id)}
              isDragging={false}
              viewMode="list"
            />
          ))}
          <SortableContext items={visibleItems.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div
              ref={parentRef}
              className="overflow-y-auto flex-1"
              style={{ contain: "strict" }}
            >
              <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = visibleItems[virtualRow.index];
                  return (
                    <div
                      key={item.id}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{ position: "absolute", top: virtualRow.start, left: 0, right: 0 }}
                    >
                      <InventoryItemCard
                        item={item}
                        viewMode="list"
                        isSelected={selectedItemIds.has(item.id)}
                        onCheckboxToggle={() => toggleSelectItem(item.id)}
                        onShiftClick={(id) => rangeSelectItems(lastSelectedId ?? id, id, visibleItems.map(i => i.id))}
                        isMultiSelectActive={selectedItemIds.size > 0}
                        isDragging={activeId === item.id}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </SortableContext>

          {/* DragOverlay for list mode */}
          <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
            {activeId && (() => {
              const item = visibleItems.find((i) => i.id === activeId);
              if (!item) return null;
              return (
                <div className="pointer-events-none opacity-90 shadow-xl">
                  <InventoryItemCard
                    item={item}
                    viewMode="list"
                    isSelected={false}
                    onCheckboxToggle={() => { }}
                    isDragging={false}
                  />
                </div>
              );
            })()}
          </DragOverlay>

          {gridMenu && <GridContextMenu x={gridMenu.x} y={gridMenu.y} onClose={() => setGridMenu(null)} />}
        </div>
      </DndContext>
    );
  }

  // GRID MODE (full DnD, no virtualization)
  const isDragging = activeId !== null;
  const activeItem = activeId ? visibleItems.find((i) => i.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderFirstCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        ref={gridContainerRef}
        className="relative flex-1 flex flex-col gap-3 overflow-y-auto min-h-0"
        onContextMenu={handleGridContextMenu}
      >
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${minCardWidth}px, ${maxCardWidth}px))`,
          }}
        >
          {selectedFolderId && <GoUpZone isDragging={isDragging} />}
          <SortableContext
            items={currentFolders.map((f) => `folder-${f.id}`)}
            strategy={rectSortingStrategy}
          >
            {currentFolders.map((folder) => (
              <SortableFolderCard
                key={folder.id}
                folder={folder}
                itemCount={folderItemCounts(folder.id)}
                onOpen={(id) => selectFolder(id)}
                isDragging={isDragging}
              />
            ))}
          </SortableContext>
          <SortableContext items={displayOrder} strategy={rectSortingStrategy}>
            {sortedItems.map((item) => (
              <InventoryItemCard
                key={item.id}
                item={item}
                viewMode="grid"
                isSelected={selectedItemIds.has(item.id)}
                onCheckboxToggle={() => toggleSelectItem(item.id)}
                isDragging={activeId === item.id}
              />
            ))}
          </SortableContext>
        </div>
        <DragOverlay dropAnimation={{
          duration: 220,
          easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
        }}>
          {activeItem && (
            <div
              className="pointer-events-none"
              style={{
                transform: "rotate(2deg) scale(1.06)",
                opacity: 0.92,
                boxShadow: "0 20px 40px rgba(0,0,0,0.6)",
                borderRadius: "0.5rem",
                willChange: "transform",
                transition: "none",
              }}
            >
              <InventoryItemCard
                item={activeItem}
                viewMode="grid"
                isSelected={false}
                onCheckboxToggle={() => { }}
                isDragging={false}
              />
            </div>
          )}
        </DragOverlay>
        {gridMenu && (
          <GridContextMenu
            x={gridMenu.x}
            y={gridMenu.y}
            onClose={() => setGridMenu(null)}
          />
        )}
      </div>
    </DndContext>
  );
}


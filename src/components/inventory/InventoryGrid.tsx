import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  pointerWithin, useSensor, useSensors, PointerSensor,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { Loader2 } from "lucide-react";
import { useState, useCallback } from "react";
import { useInventoryStore } from "@/store/inventoryStore";
import { InventoryItemCard } from "./InventoryItemCard";
import { FolderCard, GoUpZone } from "./FolderCard";
import { useAppearanceStore } from "@/store/appearanceStore";
import { GridContextMenu } from "./GridContextMenu";
import { useT } from "@/i18n";

interface InventoryGridProps {
  tagFilter?: string | null;
}

// Custom collision detection to prioritize folders and root
const folderFirstCollision = (args: any) => {
  const { pointerCoordinates, droppableContainers, active } = args;
  if (!pointerCoordinates) return [];

  const collisions = pointerWithin(args);

  // Sort: folders first, then items
  const folderCollisions = collisions.filter(
    (c) => c.id.toString().startsWith("folder:") || c.id.toString() === "root"
  );
  const otherCollisions = collisions.filter(
    (c) => !c.id.toString().startsWith("folder:") && c.id.toString() !== "root"
  );

  return [...folderCollisions, ...otherCollisions];
};

export function InventoryGrid({ tagFilter }: InventoryGridProps = {}) {
  const t = useT();
  const inventoryItemSize = useAppearanceStore((s) => s.inventoryItemSize);
  const {
    filteredItems, loading, error, selectedFolderId, selectFolder,
    folders, moveItem, reorderItems, sortField,
    selectedItemIds, toggleSelectItem, viewMode,
  } = useInventoryStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number } | null>(null);

  // PointerSensor con delay de 200ms — "hold to drag"
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { delay: 200, tolerance: 12 },
  });
  const sensors = useSensors(pointerSensor);

  const gridCols = {
    compact: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7",
    normal:  "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6",
    large:   "grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4",
  }[inventoryItemSize];

  const handleGridContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement) !== e.currentTarget) return; // solo en fondo vacío
    e.preventDefault();
    setGridMenu({ x: e.clientX, y: e.clientY });
  };

  const allItems = filteredItems();
  const items = tagFilter
    ? allItems.filter((i) => i.tags.includes(tagFilter))
    : allItems;

  // Carpetas a mostrar en el nivel actual
  const currentFolders = folders.filter(
    (f) => f.parent_id === (selectedFolderId ?? null)
  );

  // Contar items por carpeta (placeholder)
  const folderItemCounts = useCallback((folderId: string): number => {
    // TODO: implementar conteo real si se necesita
    return 0;
  }, []);

  const isDragging = activeId !== null;
  const activeItem = activeId ? items.find((i) => i.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    if (!localOrder) setLocalOrder(items.map((i) => i.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!localOrder) return;
    const { active, over } = event;
    if (!over) return;
    const overId = String(over.id);
    if (overId.startsWith("folder:") || overId === "root") return;
    const oldIdx = localOrder.indexOf(String(active.id));
    const newIdx = localOrder.indexOf(overId);
    if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
      setLocalOrder(arrayMove(localOrder, oldIdx, newIdx));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) { setLocalOrder(null); return; }

    const itemId  = String(active.id);
    const targetId = String(over.id);

    // Drop en carpeta
    if (targetId.startsWith("folder:")) {
      const folderId = targetId.replace("folder:", "");
      await moveItem(itemId, folderId);
      setLocalOrder(null);
      return;
    }

    // Drop en "root" (GoUpZone — sacar de carpeta)
    if (targetId === "root" && selectedFolderId) {
      await moveItem(itemId, "__root__");   // el backend interpreta "__root__" como sin carpeta
      setLocalOrder(null);
      return;
    }

    // Reorder dentro del mismo grid (sólo si sortField === "custom")
    if (localOrder && sortField === "custom") {
      await reorderItems(localOrder);
    }
    setLocalOrder(null);
  };

  const displayOrder = localOrder ?? items.map((i) => i.id);
  const sortedItems = displayOrder
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean) as typeof items;

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
  if (items.length === 0 && currentFolders.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 h-48 text-zinc-500 text-sm">
        {t("inventory_no_items")}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderFirstCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* Contenedor principal con menú contextual */}
      <div
        className="relative flex-1 flex flex-col gap-3"
        onContextMenu={handleGridContextMenu}
      >
        {viewMode === "grid" ? (
          <div className={`grid ${gridCols} gap-3`}>
            {/* Zona para sacar de carpeta (solo cuando estamos dentro de una) */}
            {selectedFolderId && <GoUpZone isDragging={isDragging} />}
            {currentFolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                itemCount={folderItemCounts(folder.id)}
                onOpen={(id) => selectFolder(id)}
                isDragging={isDragging}
                viewMode="grid"
              />
            ))}
            <SortableContext items={displayOrder} strategy={rectSortingStrategy}>
              {sortedItems.map((item) => (
                <InventoryItemCard
                  key={item.id}
                  item={item}
                  viewMode="grid"
                  isSelected={selectedItemIds.has(item.id)}
                  onCheckboxToggle={() => toggleSelectItem(item.id)}
                  isDragging={isDragging && activeId === item.id}
                />
              ))}
            </SortableContext>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-zinc-800/60">
            {/* Zona para sacar de carpeta (solo cuando estamos dentro de una) */}
            {selectedFolderId && <GoUpZone isDragging={isDragging} />}
            {currentFolders.map((folder) => (
              <FolderCard
                key={folder.id}
                folder={folder}
                itemCount={folderItemCounts(folder.id)}
                onOpen={(id) => selectFolder(id)}
                isDragging={isDragging}
                viewMode="list"
              />
            ))}
            <SortableContext items={displayOrder} strategy={rectSortingStrategy}>
              {sortedItems.map((item) => (
                <InventoryItemCard
                  key={item.id}
                  item={item}
                  viewMode="list"
                  isSelected={selectedItemIds.has(item.id)}
                  onCheckboxToggle={() => toggleSelectItem(item.id)}
                  isDragging={isDragging && activeId === item.id}
                />
              ))}
            </SortableContext>
          </div>
        )}

        {/* Drag overlay — previsualización while dragging */}
        <DragOverlay>
          {activeItem && (
            <div className={`opacity-80 pointer-events-none ${viewMode === "grid" ? "rotate-2 scale-105" : ""}`}>
              <InventoryItemCard
                item={activeItem}
                viewMode={viewMode}      // Usa el viewMode real
                isSelected={false}
                onCheckboxToggle={() => {}}
                isDragging={false}
              />
            </div>
          )}
        </DragOverlay>
      </div>

      {/* Menú contextual del grid (fuera del contenedor para evitar interferencias) */}
      {gridMenu && (
        <GridContextMenu
          x={gridMenu.x}
          y={gridMenu.y}
          onClose={() => setGridMenu(null)}
        />
      )}
    </DndContext>
  );
}
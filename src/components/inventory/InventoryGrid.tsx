import { DndContext, DragEndEvent, pointerWithin, useSensor, useSensors, MouseSensor } from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { Loader2 } from "lucide-react";
import { useInventoryStore } from "../../store/inventoryStore";
import { InventoryItemCard } from "./InventoryItemCard";
import { useT } from "../../i18n";

function FolderDropZone({ folderId }: { folderId: string | null }) {
  const { isOver, setNodeRef } = useDroppable({ id: folderId ?? "root" });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-0 rounded-xl border-2 border-dashed pointer-events-none transition-colors ${
        isOver
          ? "border-red-500 bg-red-500/5"
          : "border-transparent"
      }`}
    />
  );
}

interface InventoryGridProps {
  tagFilter?: string | null;
}

export function InventoryGrid({ tagFilter }: InventoryGridProps = {}) {
  const t = useT();
  const {
    filteredItems,
    viewMode,
    loading,
    error,
    selectedFolderId,
    moveItem,
  } = useInventoryStore();

  // Standard mouse sensor — left-click drag (activates after 8px movement, won't conflict with click)
  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: {
      distance: 8,
    },
  });
  const sensors = useSensors(mouseSensor);

  const allItems = filteredItems();
  const items = tagFilter
    ? allItems.filter((i) => i.tags.includes(tagFilter))
    : allItems;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const itemId = String(active.id);
    const targetId = String(over.id);
    if (targetId !== "root" && targetId !== itemId) {
      await moveItem(itemId, targetId);
    }
  };

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

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 h-48 text-zinc-500 text-sm">
        {t("inventory_no_items")}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      <div className="relative flex-1">
        <FolderDropZone folderId={selectedFolderId} />

        {viewMode === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {items.map((item) => (
              <InventoryItemCard key={item.id} item={item} viewMode="grid" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {items.map((item) => (
              <InventoryItemCard key={item.id} item={item} viewMode="list" />
            ))}
          </div>
        )}
      </div>
    </DndContext>
  );
}
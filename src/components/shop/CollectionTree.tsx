// src/components/shop/CollectionTree.tsx
import { useState, useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Folder, Plus } from "lucide-react";
import type { Collection } from "../../lib/tauri";

// ── CollectionRow ────────────────────────────────────────────────────────────

interface RowProps {
  col: Collection;
  depth: number;
  isSelected: boolean;
  hasChildren: boolean;
  isExpanded: boolean;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

function CollectionRow({
  col, depth, isSelected, hasChildren, isExpanded, onSelect, onToggleExpand,
}: RowProps) {
  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({
    id: `col:${col.id}`,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `col:${col.id}`,
  });

  // Merge both refs into one callback ref
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef]
  );

  return (
    <div
      ref={setRef}
      style={{ paddingLeft: depth * 14 }}
      className={[
        "flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer select-none transition-colors",
        isSelected ? "bg-zinc-800 border border-zinc-700" : "hover:bg-zinc-900",
        isOver ? "bg-red-950/30 border border-red-700/40" : "",
        isDragging ? "opacity-40" : "",
      ].filter(Boolean).join(" ")}
      onClick={() => onSelect(col.id)}
      {...attributes}
    >
      {/* Expand/collapse toggle */}
      <button
        className="w-4 h-4 flex items-center justify-center text-zinc-600 hover:text-zinc-400 shrink-0"
        style={{ visibility: hasChildren ? "visible" : "hidden" }}
        onClick={(e) => { e.stopPropagation(); onToggleExpand(col.id); }}
      >
        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Cover / drag handle */}
      <div
        className="w-5 h-5 rounded shrink-0 overflow-hidden flex items-center justify-center bg-zinc-800 cursor-grab"
        {...listeners}
      >
        {col.cover_url ? (
          <img src={col.cover_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Folder className="h-3 w-3 text-zinc-500" />
        )}
      </div>

      {/* Name */}
      <span className={`flex-1 text-[11px] truncate ${isSelected ? "text-zinc-100 font-semibold" : "text-zinc-400"}`}>
        {col.name}
      </span>

      {/* Count badge */}
      <span className="text-[9px] text-zinc-600 shrink-0">{col.item_count}</span>
    </div>
  );
}

// ── RootDropZone ─────────────────────────────────────────────────────────────

function RootDropZone({ isDraggingCol }: { isDraggingCol: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "root" });
  if (!isDraggingCol) return null;
  return (
    <div
      ref={setNodeRef}
      className={`mx-1 mb-1 h-6 rounded-lg border-dashed border text-[9px] flex items-center justify-center transition-colors ${
        isOver ? "border-red-500 bg-red-950/30 text-red-400" : "border-zinc-700 text-zinc-700"
      }`}
    >
      Mover a raíz
    </div>
  );
}

// ── CollectionTree ───────────────────────────────────────────────────────────

interface Props {
  collections: Collection[];
  selectedId: string | null;
  activeId: string | null;          // active drag id from parent DndContext
  onSelect: (id: string) => void;
  onCreateCollection: (name: string) => void;
}

export function CollectionTree({ collections, selectedId, activeId, onSelect, onCreateCollection }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateCollection(name);
    setNewName("");
  };

  const isDraggingCol = activeId?.startsWith("col:") ?? false;

  // Recursive tree render
  const renderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const children = collections.filter((c) => c.parent_id === parentId);
    return children.map((col) => {
      const hasChildren = collections.some((c) => c.parent_id === col.id);
      const isExpanded = expandedIds.has(col.id);
      return (
        <div key={col.id}>
          <CollectionRow
            col={col}
            depth={depth}
            isSelected={selectedId === col.id}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onSelect={onSelect}
            onToggleExpand={toggleExpand}
          />
          {isExpanded && hasChildren && renderTree(col.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800/60 shrink-0">
        <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Colecciones</p>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5">
        <RootDropZone isDraggingCol={isDraggingCol} />
        {collections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-zinc-700">
            <Folder className="h-6 w-6 opacity-30" />
            <p className="text-[10px]">Sin colecciones</p>
          </div>
        ) : (
          renderTree(null, 0)
        )}
      </div>

      {/* New collection input */}
      <div className="border-t border-zinc-800/60 p-2 shrink-0">
        <div className="flex gap-1.5">
          <input
            className="flex-1 px-2.5 py-1.5 text-[11px] bg-zinc-900 border border-zinc-700/60 rounded-lg text-zinc-200 placeholder-zinc-700 outline-none focus:border-zinc-500 transition-colors"
            placeholder="Nueva colección…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-30 text-white transition-colors flex items-center"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

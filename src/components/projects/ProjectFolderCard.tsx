// src/components/projects/ProjectFolderCard.tsx
import { Folder, FolderOpen, ChevronRight, Trash2, Settings2 } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { ProjectFolder } from "@/lib/tauri";
import React, { useState, useRef, useEffect } from "react";
import { useProjectsStore } from "@/store/projects";
import { tauriDeleteProjectFolder } from "@/lib/tauri";
import { ProjectFolderCustomizeModal, FolderIconDisplay } from "./ProjectFolderCustomizeModal";

interface ProjectFolderCardProps {
  folder: ProjectFolder;
  projectCount: number;
  onOpen: (folderId: string) => void;
  isDragging: boolean;
}

interface GoUpZoneProps {
  isDragging: boolean;
}

export function ProjectGoUpZone({ isDragging }: GoUpZoneProps) {
  const { isOver, setNodeRef } = useDroppable({ id: "root" });
  if (!isDragging) return null;
  return (
    <div
      ref={setNodeRef}
      className={`
        flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed
        text-xs transition-all duration-150 select-none
        ${isOver
          ? "border-red-500 bg-red-500/10 text-red-300"
          : "border-zinc-700 text-zinc-600"
        }
      `}
    >
      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      Move to root
    </div>
  );
}

// ── Context menu (shared across all variants) ────────────────────────────────
function FolderContextMenu({
  folder,
  position,
  onCustomize,
  onDelete,
  onClose,
}: {
  folder: ProjectFolder;
  position: { x: number; y: number };
  onCustomize: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", zIndex: 9999, top: position.y, left: position.x }}
      className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-48 overflow-hidden"
    >
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
        onClick={() => { onCustomize(); onClose(); }}
      >
        <Settings2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        Customize…
      </button>
      <div className="my-1 border-t border-zinc-800" />
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400 hover:bg-zinc-800"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        Delete folder
      </button>
    </div>
  );
}

// ── Icons / original view card (square) ─────────────────────────────────────
const ProjectFolderCardInner = function ProjectFolderCardInner({
  folder, projectCount, onOpen, isDragging,
}: ProjectFolderCardProps) {
  const { isOver, setNodeRef } = useDroppable({ id: `folder:${folder.id}` });
  const { removeFolder, setFolders } = useProjectsStore();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);

  const folderColor = folder.color ?? "#f59e0b";
  const dropping = isOver && isDragging;

  return (
    <>
      <div
        ref={setNodeRef}
        onDoubleClick={() => onOpen(folder.id)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        className={`
          relative flex flex-col items-center justify-center gap-2 aspect-square
          cursor-pointer transition-all duration-150 select-none border-2 rounded-xl
          ${dropping
            ? "border-red-500 bg-red-500/10 scale-105"
            : isDragging
              ? "border-dashed border-zinc-600 bg-zinc-900/40"
              : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/60"
          }
        `}
      >
        {/* Color accent bar at top */}
        <div
          className="absolute top-0 left-4 right-4 h-0.5 rounded-b-full transition-opacity"
          style={{ background: folderColor, opacity: isDragging ? 0 : 0.6 }}
        />

        {/* Icon: image > emoji > folder icon */}
        {dropping && !folder.image
          ? <FolderOpen className="h-10 w-10" style={{ color: folderColor }} />
          : <FolderIconDisplay emoji={folder.emoji} image={folder.image} color={folderColor} size="lg" />
        }

        <span className="text-[11px] font-medium truncate max-w-[90%] text-center px-1 text-zinc-300">
          {folder.name}
        </span>

        {projectCount > 0 && (
          <span className="absolute top-2 right-2 text-[9px] text-zinc-500 bg-zinc-900/80 px-1.5 py-0.5 rounded-full">
            {projectCount}
          </span>
        )}
        <ChevronRight className="absolute bottom-2 right-2 h-3 w-3 text-zinc-400" />
      </div>

      {ctxMenu && (
        <FolderContextMenu
          folder={folder}
          position={ctxMenu}
          onCustomize={() => setShowCustomize(true)}
          onDelete={async () => {
            await tauriDeleteProjectFolder(folder.id);
            removeFolder(folder.id);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {showCustomize && (
        <ProjectFolderCustomizeModal folder={folder} onClose={() => setShowCustomize(false)} />
      )}
    </>
  );
};

export const ProjectFolderCard = React.memo(ProjectFolderCardInner, (prev, next) => {
  return (
    prev.folder.id        === next.folder.id        &&
    prev.folder.name      === next.folder.name      &&
    prev.folder.color     === next.folder.color     &&
    prev.folder.emoji     === next.folder.emoji     &&
    prev.folder.image     === next.folder.image     &&
    prev.projectCount     === next.projectCount     &&
    prev.isDragging       === next.isDragging
  );
});

// ── Grid mode card (horizontal, wider) ───────────────────────────────────────
export function ProjectFolderGridCard({
  folder, projectCount, onOpen, isDragging, isOver: isOverProp,
}: ProjectFolderCardProps & { isOver?: boolean }) {
  const { removeFolder } = useProjectsStore();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);

  const folderColor = folder.color ?? "#f59e0b";
  const dropping = (isOverProp ?? false) && isDragging;

  return (
    <>
      <div
        onDoubleClick={() => onOpen(folder.id)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        className={`
          relative flex items-center gap-3 rounded-xl border-2 px-4 py-3
          cursor-pointer transition-all duration-150 select-none overflow-hidden
          ${dropping
            ? "border-red-500 bg-red-500/10"
            : isDragging
              ? "border-dashed border-zinc-600 bg-zinc-900/40"
              : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/60"
          }
        `}
        style={{ borderLeftColor: folderColor, borderLeftWidth: 3 }}
      >
        {dropping && !folder.image
          ? <FolderOpen className="h-6 w-6 shrink-0" style={{ color: folderColor }} />
          : <FolderIconDisplay emoji={folder.emoji} image={folder.image} color={folderColor} size="md" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-200 truncate">{folder.name}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {projectCount} project{projectCount !== 1 ? "s" : ""}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 text-zinc-600 shrink-0" />
      </div>

      {ctxMenu && (
        <FolderContextMenu
          folder={folder}
          position={ctxMenu}
          onCustomize={() => setShowCustomize(true)}
          onDelete={async () => {
            await tauriDeleteProjectFolder(folder.id);
            removeFolder(folder.id);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {showCustomize && (
        <ProjectFolderCustomizeModal folder={folder} onClose={() => setShowCustomize(false)} />
      )}
    </>
  );
}

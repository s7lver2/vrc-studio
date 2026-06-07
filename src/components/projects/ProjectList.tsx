import React, { useState, useCallback, useMemo } from "react";
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  pointerWithin, useSensor, useSensors, PointerSensor,
  DragOverlay, useDroppable,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Project, ProjectFolder } from "@/lib/tauri";
import { ProjectCard } from "./ProjectCard";
import {
  Boxes, LayoutGrid, List, AlignJustify, GitBranch, Info,
  Trash2, ExternalLink, Cpu, LayoutDashboard, FolderPlus, ChevronRight, Folder, FolderOpen, Settings2,
} from "lucide-react";
import { useT } from "@/i18n";
import { toAssetUrl } from "@/lib/utils";
import { useProjectsStore } from "@/store/projects";
import { ProjectFolderCard, ProjectFolderGridCard, ProjectGoUpZone } from "./ProjectFolderCard";
import { ProjectFolderCustomizeModal, FolderIconDisplay } from "./ProjectFolderCustomizeModal";
import {
  tauriMoveProjectToFolder,
  tauriMoveProjectFolderToParent,
  tauriCreateProjectFolder,
  tauriListProjectFolders,
  tauriReorderProjects,
  tauriReorderProjectFolders,
} from "@/lib/tauri";

type ViewMode = "icons" | "grid" | "list" | "compact";

interface ProjectListProps {
  projects: Project[];
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
  onDetail?: (project: Project) => void;
  onSelect?: (project: Project) => void;
  selectedId?: string;
  openProjectIds?: Set<string>;
  onUpdated?: (project: Project) => void;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

// ── Folder-first collision ────────────────────────────────────────────────────
const folderFirstCollision = (args: any) => {
  const collisions = pointerWithin(args);
  const folderCollisions = collisions.filter(
    (c) => c.id.toString().startsWith("folder:") || c.id.toString() === "root"
  );
  const others = collisions.filter(
    (c) => !c.id.toString().startsWith("folder:") && c.id.toString() !== "root"
  );
  return [...folderCollisions, ...others];
};

// ── Sortable project card wrapper ─────────────────────────────────────────────
function SortableProjectIconCard({
  project, onOpen, onDelete, onDetail, isSelected, isOpen,
}: {
  project: Project;
  onOpen: (p: Project) => void;
  onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void;
  isSelected?: boolean;
  isOpen?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `project-${project.id}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectIconCard
        project={project}
        onOpen={onOpen}
        onDelete={onDelete}
        onDetail={onDetail}
        isSelected={isSelected}
        isOpen={isOpen}
      />
    </div>
  );
}

// ── Sortable folder card wrapper (icons mode) ─────────────────────────────────
function SortableProjectFolderCard({
  folder, projectCount, onOpen, isDragging: parentIsDragging,
}: {
  folder: ProjectFolder;
  projectCount: number;
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
      <ProjectFolderCard
        folder={folder}
        projectCount={projectCount}
        onOpen={onOpen}
        isDragging={parentIsDragging || isDragging}
      />
    </div>
  );
}

// ── Sortable folder card wrapper (grid mode — horizontal card) ────────────────
function SortableProjectFolderGridCard({
  folder, projectCount, onOpen, isDragging: parentIsDragging,
}: {
  folder: ProjectFolder;
  projectCount: number;
  onOpen: (id: string) => void;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } = useSortable({
    id: `folder-${folder.id}`,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: `folder:${folder.id}` });

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => { setSortableRef(el); setDropRef(el); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
  };
  return (
    <div ref={setRef} style={style} {...attributes} {...listeners}>
      <ProjectFolderGridCard
        folder={folder}
        projectCount={projectCount}
        onOpen={onOpen}
        isDragging={parentIsDragging || isDragging}
        isOver={isOver}
      />
    </div>
  );
}

// ── Sortable project card (grid view) ─────────────────────────────────────────
function SortableProjectGridCard({
  project, onOpen, onDelete, onDetail, onSelect, isSelected, isOpen, onUpdated,
}: {
  project: Project;
  onOpen: (p: Project) => void;
  onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void;
  onSelect?: (p: Project) => void;
  isSelected?: boolean;
  isOpen?: boolean;
  onUpdated?: (p: Project) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `project-${project.id}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectCard
        project={project}
        onOpen={onOpen}
        onDelete={onDelete}
        onDetail={onDetail}
        onSelect={onSelect}
        isSelected={isSelected}
        isOpen={isOpen}
        onUpdated={onUpdated}
      />
    </div>
  );
}

// ── Sortable folder row (list view) — combines sortable + droppable ───────────
function SortableFolderListRow({
  folder, projectCount, onOpen, isDragging: parentIsDragging,
}: {
  folder: ProjectFolder;
  projectCount: number;
  onOpen: (id: string) => void;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } = useSortable({
    id: `folder-${folder.id}`,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: `folder:${folder.id}` });

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => { setSortableRef(el); setDropRef(el); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const active = parentIsDragging || isDragging;
  const dropping = isOver && active;

  const [ctxMenu, setCtxMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [showCustomize, setShowCustomize] = React.useState(false);
  const { removeFolder } = useProjectsStore();

  return (
    <>
      <div
        ref={setRef}
        style={{
          ...style,
          borderLeftColor: active ? undefined : (folder.color ?? "#f59e0b"),
          borderLeftWidth: active ? undefined : 3,
        }}
        {...attributes}
        {...listeners}
        className={cn(
          "group flex items-center gap-3 rounded-xl border-2 transition-all cursor-grab select-none overflow-hidden",
          dropping
            ? "border-red-500 bg-red-500/10"
            : active
            ? "border-dashed border-zinc-700 bg-zinc-900/40"
            : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-800/50",
        )}
        onClick={() => onOpen(folder.id)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
          {dropping && !folder.image
            ? <FolderOpen size={16} style={{ color: folder.color ?? "#f59e0b" }} className="shrink-0" />
            : <FolderIconDisplay emoji={folder.emoji} image={folder.image} color={folder.color ?? "#f59e0b"} size="sm" />
          }
          <span className="text-sm text-zinc-200 font-medium truncate flex-1">{folder.name}</span>
          <span className="text-xs text-zinc-500 shrink-0">{projectCount} project{projectCount !== 1 ? "s" : ""}</span>
          <ChevronRight size={14} className="text-zinc-600 shrink-0" />
        </div>
      </div>
      {ctxMenu && (
        <div
          className="fixed z-[9999] bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-44 overflow-hidden"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => { setShowCustomize(true); setCtxMenu(null); }}>
            <Settings2 size={13} className="text-blue-400 shrink-0" /> Customize…
          </button>
          <div className="my-1 border-t border-zinc-800" />
          <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400 hover:bg-zinc-800"
            onClick={async () => { await (await import("@/lib/tauri")).tauriDeleteProjectFolder(folder.id); removeFolder(folder.id); setCtxMenu(null); }}>
            <Trash2 size={13} className="shrink-0" /> Delete folder
          </button>
        </div>
      )}
      {showCustomize && <ProjectFolderCustomizeModal folder={folder} onClose={() => setShowCustomize(false)} />}
    </>
  );
}

// ── Sortable project row (list view) ─────────────────────────────────────────
function SortableProjectListRow({
  project, onOpen, onDelete, onDetail, isSelected,
}: {
  project: Project;
  onOpen: (p: Project) => void;
  onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void;
  isSelected?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `project-${project.id}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectListRow
        project={project}
        onOpen={onOpen}
        onDelete={onDelete}
        onDetail={onDetail}
        isSelected={isSelected}
      />
    </div>
  );
}

// ── Sortable folder row (compact view) — combines sortable + droppable ────────
function SortableFolderCompactRow({
  folder, projectCount, onOpen, isDragging: parentIsDragging,
}: {
  folder: ProjectFolder;
  projectCount: number;
  onOpen: (id: string) => void;
  isDragging: boolean;
}) {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } = useSortable({
    id: `folder-${folder.id}`,
  });
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: `folder:${folder.id}` });

  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => { setSortableRef(el); setDropRef(el); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const active = parentIsDragging || isDragging;
  const dropping = isOver && active;
  const folderColor = folder.color ?? "#f59e0b";
  const [ctxMenu2, setCtxMenu2] = React.useState<{ x: number; y: number } | null>(null);
  const [showCustomize2, setShowCustomize2] = React.useState(false);
  const { removeFolder: removeFolderC } = useProjectsStore();

  return (
    <>
      <div
        ref={setRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          "flex items-center gap-3 px-3 py-1.5 transition-colors cursor-grab select-none",
          dropping ? "bg-red-500/10" : active ? "bg-zinc-800/40" : "hover:bg-zinc-800/60",
        )}
        onClick={() => onOpen(folder.id)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu2({ x: e.clientX, y: e.clientY }); }}
      >
        {/* Color dot */}
        <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: folderColor }} />
        {dropping && !folder.image
          ? <FolderOpen size={12} style={{ color: folderColor }} className="shrink-0" />
          : <FolderIconDisplay emoji={folder.emoji} image={folder.image} color={folderColor} size="sm" />
        }
        <span className="text-sm font-medium text-zinc-300 truncate flex-1">{folder.name}</span>
        <span className="text-xs text-zinc-600 hidden sm:block w-28 shrink-0">
          {projectCount} project{projectCount !== 1 ? "s" : ""}
        </span>
        <ChevronRight size={12} className="text-zinc-600 shrink-0" />
      </div>
      {ctxMenu2 && (
        <div
          className="fixed z-[9999] bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-44 overflow-hidden"
          style={{ top: ctxMenu2.y, left: ctxMenu2.x }}
          onMouseLeave={() => setCtxMenu2(null)}
        >
          <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => { setShowCustomize2(true); setCtxMenu2(null); }}>
            <Settings2 size={13} className="text-blue-400 shrink-0" /> Customize…
          </button>
          <div className="my-1 border-t border-zinc-800" />
          <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400 hover:bg-zinc-800"
            onClick={async () => { await (await import("@/lib/tauri")).tauriDeleteProjectFolder(folder.id); removeFolderC(folder.id); setCtxMenu2(null); }}>
            <Trash2 size={13} className="shrink-0" /> Delete folder
          </button>
        </div>
      )}
      {showCustomize2 && <ProjectFolderCustomizeModal folder={folder} onClose={() => setShowCustomize2(false)} />}
    </>
  );
}

// ── Sortable project row (compact view) ──────────────────────────────────────
function SortableProjectCompactRow({
  project, onOpen, onDelete, onDetail, isSelected,
}: {
  project: Project;
  onOpen: (p: Project) => void;
  onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void;
  isSelected?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `project-${project.id}`,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <ProjectCompactRow
        project={project}
        onOpen={onOpen}
        onDelete={onDelete}
        onDetail={onDetail}
        isSelected={isSelected}
      />
    </div>
  );
}

// ── Icon card ────────────────────────────────────────────────────────────────
function ProjectIconCard({ project, onOpen, onDelete, onDetail, isSelected, isOpen }: {
  project: Project; onOpen: (p: Project) => void; onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void; isSelected?: boolean; isOpen?: boolean;
}) {
  const t = useT();
  const coverSrc = project.cover_image_path
    ? toAssetUrl(project.cover_image_path)
    : project.last_screenshot
    ? toAssetUrl(project.last_screenshot)
    : null;

  return (
    <div
      className={cn(
        "group relative flex flex-col items-center gap-2.5 rounded-xl p-3 transition-colors cursor-pointer select-none",
        isSelected ? "bg-red-950/30 ring-2 ring-red-600" : "hover:bg-zinc-800/60"
      )}
      onClick={() => onDetail?.(project)}
    >
      <div className={cn(
        "relative w-full aspect-square rounded-xl overflow-hidden border-2 shrink-0",
        isOpen ? "border-green-600/60" : isSelected ? "border-red-600/60" : "border-zinc-800"
      )}>
        {coverSrc ? (
          <img
            src={coverSrc}
            alt={project.name}
            className="w-full h-full object-cover"
            style={isOpen ? undefined : { filter: "brightness(0.85)" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-12 w-12 text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.328l5.603 3.113Z" />
            </svg>
          </div>
        )}
        {isOpen && (
          <span className="absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-green-950/90 text-green-400 border border-green-800/60">
            Open
          </span>
        )}
        <div className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            aria-label={t("project_card_details")}
            onClick={(e) => { e.stopPropagation(); onDetail?.(project); }}
            className="rounded-lg p-2 bg-zinc-900/90 text-zinc-300 hover:text-white transition-colors"
          >
            <Info size={15} />
          </button>
          <button
            aria-label={t("project_detail_open_unity")}
            onClick={(e) => { e.stopPropagation(); onOpen(project); }}
            className="rounded-lg p-2 bg-zinc-900/90 text-zinc-300 hover:text-white transition-colors"
          >
            <ExternalLink size={15} />
          </button>
          <button
            aria-label={t("project_delete_title")}
            onClick={(e) => { e.stopPropagation(); onDelete(project); }}
            className="rounded-lg p-2 bg-zinc-900/90 text-zinc-300 hover:text-red-400 transition-colors"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <p className="text-xs font-semibold text-zinc-200 text-center leading-tight line-clamp-2 w-full px-0.5">
        {project.name}
      </p>
      <p className="text-[10px] text-zinc-600 font-mono -mt-1">{project.unity_version}</p>
    </div>
  );
}

function ProjectListRow({ project, onOpen, onDelete, onDetail, isSelected }: {
  project: Project; onOpen: (p: Project) => void; onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void; isSelected?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-lg border bg-zinc-900 px-4 py-3 transition-colors cursor-pointer",
        isSelected ? "border-red-600" : "border-zinc-800 hover:border-zinc-700"
      )}
      onClick={() => onDetail?.(project)}
    >
      <div className="h-14 w-24 shrink-0 rounded-md overflow-hidden bg-zinc-950 border border-zinc-800/60">
        {project.cover_image_path || project.last_screenshot ? (
          <img src={toAssetUrl(project.cover_image_path ?? project.last_screenshot) ?? undefined} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-800">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.328l5.603 3.113Z" />
            </svg>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-zinc-100 text-sm">{project.name}</h3>
        <p className="mt-0.5 text-xs text-zinc-600 truncate font-mono">{project.path}</p>
      </div>
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <Cpu className="h-3 w-3" /><span>{project.unity_version}</span>
        </div>
        {project.shader && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">{project.shader}</span>}
        {project.vcs_enabled && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 flex items-center gap-1"><GitBranch className="h-2.5 w-2.5" /> git</span>}
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", project.unity_type === "custom" ? "bg-red-950 text-red-400" : "bg-zinc-800 text-zinc-400")}>{project.unity_type}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button aria-label="Details" onClick={(e) => { e.stopPropagation(); onDetail?.(project); }} className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"><Info size={14} /></button>
        <button aria-label="Open" onClick={(e) => { e.stopPropagation(); onOpen(project); }} className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"><ExternalLink size={14} /></button>
        <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(project); }} className="rounded p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

function ProjectCompactRow({ project, onOpen, onDelete, onDetail, isSelected }: {
  project: Project; onOpen: (p: Project) => void; onDelete: (p: Project) => void;
  onDetail?: (p: Project) => void; isSelected?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-3 py-1.5 transition-colors cursor-pointer",
        isSelected ? "bg-red-950/20" : "hover:bg-zinc-800/60"
      )}
      onClick={() => onDetail?.(project)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", project.unity_type === "custom" ? "bg-red-500" : "bg-zinc-600")} />
      <span className="text-sm font-medium text-zinc-200 truncate flex-1 min-w-0">{project.name}</span>
      <span className="text-xs text-zinc-600 font-mono shrink-0 hidden sm:block w-28">{project.unity_version}</span>
      <div className="hidden md:flex items-center gap-2 shrink-0 w-24">
        {project.shader && <span className="text-[10px] text-zinc-600">{project.shader}</span>}
        {project.vcs_enabled && <GitBranch className="h-3 w-3 text-zinc-700" />}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button aria-label="Details" onClick={(e) => { e.stopPropagation(); onDetail?.(project); }} className="rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"><Info size={12} /></button>
        <button aria-label="Open" onClick={(e) => { e.stopPropagation(); onOpen(project); }} className="rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"><ExternalLink size={12} /></button>
        <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(project); }} className="rounded p-1 text-zinc-600 hover:text-red-400 hover:bg-zinc-700 transition-colors"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const t = useT();
  const opts: { id: ViewMode; icon: React.ElementType; label: string }[] = [
    { id: "icons",   icon: LayoutDashboard, label: "Icons" },
    { id: "grid",    icon: LayoutGrid,      label: t("project_list_view_grid") },
    { id: "list",    icon: List,            label: t("project_list_view_list") },
    { id: "compact", icon: AlignJustify,    label: t("project_list_view_compact") },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {opts.map((o) => (
        <button key={o.id} title={o.label} onClick={() => onChange(o.id)}
          className={cn("h-7 w-7 flex items-center justify-center rounded transition-colors",
            mode === o.id ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800"
          )}
        >
          <o.icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
function FolderBreadcrumb({
  folders, selectedFolderId, onNavigate,
}: {
  folders: ProjectFolder[];
  selectedFolderId: string | null;
  onNavigate: (id: string | null) => void;
}) {
  if (!selectedFolderId) return null;

  const breadcrumb: ProjectFolder[] = [];
  let current: string | null = selectedFolderId;
  while (current) {
    const folder = folders.find((f) => f.id === current);
    if (!folder) break;
    breadcrumb.unshift(folder);
    current = folder.parent_id;
  }

  return (
    <div className="flex items-center gap-1 text-xs text-zinc-500">
      <button
        onClick={() => onNavigate(null)}
        className="hover:text-zinc-300 transition-colors"
      >
        Projects
      </button>
      {breadcrumb.map((f) => (
        <React.Fragment key={f.id}>
          <ChevronRight className="h-3 w-3" />
          <button
            onClick={() => onNavigate(f.id)}
            className={cn(
              "transition-colors",
              f.id === selectedFolderId ? "text-zinc-200 font-medium" : "hover:text-zinc-300"
            )}
          >
            {f.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ProjectList({
  projects, onOpen, onDelete, onDetail, onSelect, selectedId, openProjectIds, onUpdated,
}: ProjectListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("icons");
  const t = useT();

  const {
    folders, selectedFolderId, selectFolder, setFolders, updateProject, reorderProjects,
  } = useProjectsStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const sensors = useSensors(pointerSensor);

  // Folders visible in current directory
  const currentFolders = useMemo(
    () => folders.filter((f) => f.parent_id === (selectedFolderId ?? null)),
    [folders, selectedFolderId]
  );

  // Projects visible in current folder (null = root = those with no folder_id OR folder_id not in folders)
  const visibleProjects = useMemo(() => {
    if (selectedFolderId) {
      return projects.filter((p) => p.folder_id === selectedFolderId);
    }
    return projects.filter((p) => !p.folder_id || !folders.find((f) => f.id === p.folder_id));
  }, [projects, selectedFolderId, folders]);

  // Project counts per folder
  const projectCountForFolder = useCallback((folderId: string): number => {
    return projects.filter((p) => p.folder_id === folderId).length;
  }, [projects]);

  // Sortable IDs
  const sortableIds = useMemo(() => [
    ...currentFolders.map((f) => `folder-${f.id}`),
    ...visibleProjects.map((p) => `project-${p.id}`),
  ], [currentFolders, visibleProjects]);

  const isDragging = activeId !== null;

  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(e.active.id.toString());
  }, []);

  const handleDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeStr = active.id.toString();
    const overStr = over.id.toString();

    const isFolder = activeStr.startsWith("folder-");
    const isProject = activeStr.startsWith("project-");

    if (overStr === "root") {
      // Move to root
      if (isFolder) {
        const folderId = activeStr.replace("folder-", "");
        await tauriMoveProjectFolderToParent(folderId, null);
        setFolders(await tauriListProjectFolders());
      } else if (isProject) {
        const projectId = activeStr.replace("project-", "");
        await tauriMoveProjectToFolder(projectId, null);
        const proj = projects.find((p) => p.id === projectId);
        if (proj) updateProject({ ...proj, folder_id: null });
      }
      return;
    }

    if (overStr.startsWith("folder:")) {
      // Drop onto a folder droppable zone
      const targetFolderId = overStr.replace("folder:", "");
      if (isFolder) {
        const folderId = activeStr.replace("folder-", "");
        if (folderId === targetFolderId) return;
        await tauriMoveProjectFolderToParent(folderId, targetFolderId);
        setFolders(await tauriListProjectFolders());
      } else if (isProject) {
        const projectId = activeStr.replace("project-", "");
        await tauriMoveProjectToFolder(projectId, targetFolderId);
        const proj = projects.find((p) => p.id === projectId);
        if (proj) updateProject({ ...proj, folder_id: targetFolderId });
      }
      return;
    }

    // Same-level reorder: active and over are both sortable items (folder- or project-)
    if (activeStr === overStr) return;

    if (isFolder && overStr.startsWith("folder-")) {
      // Reorder folders
      const oldIdx = currentFolders.findIndex((f) => `folder-${f.id}` === activeStr);
      const newIdx = currentFolders.findIndex((f) => `folder-${f.id}` === overStr);
      if (oldIdx === -1 || newIdx === -1) return;
      const newOrder = arrayMove(currentFolders, oldIdx, newIdx);
      setFolders(folders.map((f) => {
        const idx = newOrder.findIndex((nf) => nf.id === f.id);
        return idx !== -1 ? { ...f, sort_order: idx } : f;
      }));
      await tauriReorderProjectFolders(newOrder.map((f) => f.id));
      setFolders(await tauriListProjectFolders());
    } else if (isProject && overStr.startsWith("project-")) {
      // Reorder projects
      const oldIdx = visibleProjects.findIndex((p) => `project-${p.id}` === activeStr);
      const newIdx = visibleProjects.findIndex((p) => `project-${p.id}` === overStr);
      if (oldIdx === -1 || newIdx === -1) return;
      const newOrder = arrayMove(visibleProjects, oldIdx, newIdx);
      // Optimistic update: reorder all projects keeping non-visible ones at the end
      const allProjectIds = [
        ...newOrder.map((p) => p.id),
        ...projects.filter((p) => !visibleProjects.find((vp) => vp.id === p.id)).map((p) => p.id),
      ];
      reorderProjects(allProjectIds);
      await tauriReorderProjects(allProjectIds);
    }
  }, [projects, visibleProjects, currentFolders, folders, updateProject, setFolders, reorderProjects]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const id = await tauriCreateProjectFolder(name, selectedFolderId ?? undefined);
    const updated = await tauriListProjectFolders();
    setFolders(updated);
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const totalCount = projects.length;
  const pluralS = totalCount !== 1 ? "s" : "";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={folderFirstCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderBreadcrumb
              folders={folders}
              selectedFolderId={selectedFolderId}
              onNavigate={selectFolder}
            />
            {!selectedFolderId && (
              <span className="text-xs text-zinc-600">
                {t("project_list_count", { count: totalCount, s: pluralS })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCreatingFolder(true)}
              title="New folder"
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              <FolderPlus size={13} />
              New folder
            </button>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* New folder input */}
        {creatingFolder && (
          <div className="flex items-center gap-2">
            <Folder size={14} className="text-amber-400 shrink-0" />
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
              }}
              onBlur={() => { if (!newFolderName.trim()) { setCreatingFolder(false); } }}
              placeholder="Folder name"
              className="bg-zinc-800 border border-zinc-600 rounded-md px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-red-500 w-48"
            />
            <button
              onClick={handleCreateFolder}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Go up zone when dragging */}
        <ProjectGoUpZone isDragging={isDragging} />

        {/* Empty state */}
        {currentFolders.length === 0 && visibleProjects.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <Boxes size={40} className="text-zinc-700" />
            <p className="text-sm font-medium text-zinc-500">
              {selectedFolderId ? "This folder is empty" : t("project_list_no_projects")}
            </p>
            {!selectedFolderId && (
              <p className="text-xs text-zinc-600">{t("project_list_no_projects_desc")}</p>
            )}
          </div>
        )}

        {/* Icons view */}
        {viewMode === "icons" && (currentFolders.length > 0 || visibleProjects.length > 0) && (
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {currentFolders.map((folder) => (
                <SortableProjectFolderCard
                  key={folder.id}
                  folder={folder}
                  projectCount={projectCountForFolder(folder.id)}
                  onOpen={selectFolder}
                  isDragging={isDragging}
                />
              ))}
              {visibleProjects.map((project) => (
                <SortableProjectIconCard
                  key={project.id}
                  project={project}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  onDetail={onDetail}
                  isSelected={selectedId === project.id}
                  isOpen={openProjectIds?.has(project.id) ?? false}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {/* Grid view */}
        {viewMode === "grid" && (
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            {currentFolders.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {currentFolders.map((folder) => (
                  <SortableProjectFolderGridCard
                    key={folder.id}
                    folder={folder}
                    projectCount={projectCountForFolder(folder.id)}
                    onOpen={selectFolder}
                    isDragging={isDragging}
                  />
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleProjects.map((project) => (
                <SortableProjectGridCard
                  key={project.id}
                  project={project}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  onDetail={onDetail}
                  onSelect={onSelect}
                  isSelected={selectedId === project.id}
                  isOpen={openProjectIds?.has(project.id) ?? false}
                  onUpdated={onUpdated}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {/* List view */}
        {viewMode === "list" && (
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <div className="flex flex-col gap-2">
              {currentFolders.map((folder) => (
                <SortableFolderListRow
                  key={folder.id}
                  folder={folder}
                  projectCount={projectCountForFolder(folder.id)}
                  onOpen={selectFolder}
                  isDragging={isDragging}
                />
              ))}
              {visibleProjects.map((project) => (
                <SortableProjectListRow
                  key={project.id}
                  project={project}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  onDetail={onDetail}
                  isSelected={selectedId === project.id}
                />
              ))}
            </div>
          </SortableContext>
        )}

        {/* Compact view */}
        {viewMode === "compact" && (
          <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
            <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
                <span className="w-1.5 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 flex-1">{t("project_list_col_name")}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 hidden sm:block w-28 shrink-0">{t("project_list_col_version")}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 hidden md:block w-24 shrink-0">{t("project_list_col_tags")}</span>
                <span className="w-20 shrink-0" />
              </div>
              <div className="divide-y divide-zinc-800/40">
                {currentFolders.map((folder) => (
                  <SortableFolderCompactRow
                    key={folder.id}
                    folder={folder}
                    projectCount={projectCountForFolder(folder.id)}
                    onOpen={selectFolder}
                    isDragging={isDragging}
                  />
                ))}
                {visibleProjects.map((project) => (
                  <SortableProjectCompactRow
                    key={project.id}
                    project={project}
                    onOpen={onOpen}
                    onDelete={onDelete}
                    onDetail={onDetail}
                    isSelected={selectedId === project.id}
                  />
                ))}
              </div>
            </div>
          </SortableContext>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeId?.startsWith("project-") && (() => {
          const project = projects.find((p) => `project-${p.id}` === activeId);
          if (!project) return null;
          return (
            <div className="rounded-xl border-2 border-red-500/60 bg-zinc-900/90 p-2 opacity-90 shadow-2xl w-28">
              <div className="aspect-square rounded-lg overflow-hidden bg-zinc-800">
                {project.cover_image_path && (
                  <img src={toAssetUrl(project.cover_image_path) ?? undefined} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <p className="text-[10px] text-zinc-300 text-center mt-1 truncate">{project.name}</p>
            </div>
          );
        })()}
        {activeId?.startsWith("folder-") && (() => {
          const folder = folders.find((f) => `folder-${f.id}` === activeId);
          if (!folder) return null;
          return (
            <div className="rounded-xl border-2 border-amber-500/60 bg-zinc-900/90 p-3 opacity-90 shadow-2xl w-28 flex flex-col items-center gap-1">
              <Folder size={28} style={{ color: folder.color ?? "#f59e0b" }} />
              <p className="text-[10px] text-zinc-300 text-center truncate w-full">{folder.name}</p>
            </div>
          );
        })()}
      </DragOverlay>
    </DndContext>
  );
}
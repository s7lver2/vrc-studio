import React, { useState } from "react";
import { Project } from "@/lib/tauri";
import { ProjectCard } from "./ProjectCard";
import { Boxes, LayoutGrid, List, AlignJustify, GitBranch, Info, Trash2, ExternalLink, Cpu } from "lucide-react";
import { useT } from "@/i18n";
import { toAssetUrl } from "@/lib/utils";

type ViewMode = "grid" | "list" | "compact";

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
        {project.last_screenshot ? (
          <img src={toAssetUrl(project.last_screenshot) ?? undefined} alt="Last session" className="w-full h-full object-cover" />
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
        <button aria-label={t("project_detail_badge_unity")} onClick={(e) => { e.stopPropagation(); onDetail?.(project); }} className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"><Info size={14} /></button>
        <button aria-label={t("project_detail_open_unity")} onClick={(e) => { e.stopPropagation(); onOpen(project); }} className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"><ExternalLink size={14} /></button>
        <button aria-label={t("project_delete_title")} onClick={(e) => { e.stopPropagation(); onDelete(project); }} className="rounded p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"><Trash2 size={14} /></button>
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
        <button aria-label={t("project_detail_badge_unity")} onClick={(e) => { e.stopPropagation(); onDetail?.(project); }} className="rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"><Info size={12} /></button>
        <button aria-label={t("project_detail_open_unity")} onClick={(e) => { e.stopPropagation(); onOpen(project); }} className="rounded p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"><ExternalLink size={12} /></button>
        <button aria-label={t("project_delete_title")} onClick={(e) => { e.stopPropagation(); onDelete(project); }} className="rounded p-1 text-zinc-600 hover:text-red-400 hover:bg-zinc-700 transition-colors"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const t = useT();
  const opts: { id: ViewMode; icon: React.ElementType; label: string }[] = [
    { id: "grid",    icon: LayoutGrid,   label: t("project_list_view_grid") },
    { id: "list",    icon: List,         label: t("project_list_view_list") },
    { id: "compact", icon: AlignJustify, label: t("project_list_view_compact") },
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

export function ProjectList({ projects, onOpen, onDelete, onDetail, onSelect, selectedId, openProjectIds, onUpdated }: ProjectListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const t = useT();

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <Boxes size={40} className="text-zinc-700" />
        <p className="text-sm font-medium text-zinc-500">{t("project_list_no_projects")}</p>
        <p className="text-xs text-zinc-600">{t("project_list_no_projects_desc")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-600">{t("project_list_count", { count: projects.length, s: projects.length !== 1 ? "s" : "" })}</span>
        <ViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {viewMode === "grid" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onOpen={onOpen} onDelete={onDelete} onDetail={onDetail} onSelect={onSelect} isSelected={selectedId === project.id} isOpen={openProjectIds?.has(project.id) ?? false} onUpdated={onUpdated} />
          ))}
        </div>
      )}

      {viewMode === "list" && (
        <div className="flex flex-col gap-2">
          {projects.map((project) => (
            <ProjectListRow key={project.id} project={project} onOpen={onOpen} onDelete={onDelete} onDetail={onDetail} isSelected={selectedId === project.id} />
          ))}
        </div>
      )}

      {viewMode === "compact" && (
        <div className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
            <span className="w-1.5 shrink-0" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 flex-1">{t("project_list_col_name")}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 hidden sm:block w-28 shrink-0">{t("project_list_col_version")}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 hidden md:block w-24 shrink-0">{t("project_list_col_tags")}</span>
            <span className="w-20 shrink-0" />
          </div>
          <div className="divide-y divide-zinc-800/40">
            {projects.map((project) => (
              <ProjectCompactRow key={project.id} project={project} onOpen={onOpen} onDelete={onDelete} onDetail={onDetail} isSelected={selectedId === project.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
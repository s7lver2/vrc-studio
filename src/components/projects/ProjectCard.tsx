import { Project } from "@/lib/tauri";
import { Trash2, ExternalLink, Info } from "lucide-react";

interface ProjectCardProps {
  project: Project;
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
  onDetail?: (project: Project) => void;
  onSelect?: (project: Project) => void;
  isSelected?: boolean;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function ProjectCard({ project, onOpen, onDelete, onDetail, onSelect, isSelected }: ProjectCardProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border bg-zinc-900 p-4 transition-colors cursor-pointer",
        isSelected ? "border-red-600" : "border-zinc-800 hover:border-zinc-700"
      )}
      onClick={() => onDetail?.(project)}
    >
      {/* Screenshot thumbnail */}
      {project.last_screenshot ? (
        <div className="w-full aspect-video rounded-md overflow-hidden bg-zinc-950">
          <img
            src={`asset://${project.last_screenshot}`}
            alt="Last session"
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-full aspect-video rounded-md bg-zinc-950 flex items-center justify-center text-zinc-800 border border-zinc-800/60">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.328l5.603 3.113Z" />
          </svg>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-zinc-100 text-sm">{project.name}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{project.unity_version}</p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            aria-label="Details"
            onClick={(e) => { e.stopPropagation(); onDetail?.(project); }}
            className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Info size={14} />
          </button>
          <button
            aria-label="Delete"
            onClick={(e) => { e.stopPropagation(); onDelete(project); }}
            className="rounded p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <p className="truncate text-xs text-zinc-600">{project.path}</p>

      <div className="flex flex-wrap gap-1.5">
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium",
          project.unity_type === "custom" ? "bg-red-950 text-red-400" : "bg-zinc-800 text-zinc-400"
        )}>
          {project.unity_type}
        </span>
        {project.shader && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            {project.shader}
          </span>
        )}
        {project.vcs_enabled && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">git</span>
        )}
      </div>

      <button
        aria-label="Open in Unity"
        onClick={(e) => { e.stopPropagation(); onOpen(project); }}
        className="mt-1 flex items-center justify-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
      >
        <ExternalLink size={12} />
        Open in Unity
      </button>
    </div>
  );
}
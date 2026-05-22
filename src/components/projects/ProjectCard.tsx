import { useState } from "react";
import { Project, tauriCompressProject, tauriDecompressProject, tauriFocusUnityWindow } from "@/lib/tauri";
import { Trash2, ExternalLink, Info, Archive, PackageOpen, Loader2, MonitorUp } from "lucide-react";
import { toAssetUrl } from "@/lib/utils";
import { ProjectCompressionPopup } from "./ProjectCompressionPopup";
import { useT } from "@/i18n";

interface ProjectCardProps {
  project: Project;
  onOpen: (project: Project) => void;
  onDelete: (project: Project) => void;
  onDetail?: (project: Project) => void;
  onSelect?: (project: Project) => void;
  isSelected?: boolean;
  isOpen?: boolean;
  onUpdated?: (project: Project) => void;
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function ProjectCard({ project, onOpen, onDelete, onDetail, onSelect, isSelected, isOpen = false, onUpdated }: ProjectCardProps) {
  const t = useT();
  const [compressing, setCompressing] = useState(false);
  const [compressionMode, setCompressionMode] = useState<"compress" | "decompress">("compress");

  const handleCompress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCompressionMode("compress");
    setCompressing(true);
    await tauriCompressProject(project.id).catch(() => {});
  };

  const handleDecompress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCompressionMode("decompress");
    setCompressing(true);
    await tauriDecompressProject(project.id).catch(() => {});
  };

  const handleCompressionDone = () => {
    setCompressing(false);
    const updated: Project = { ...project, is_compressed: compressionMode === "compress" };
    onUpdated?.(updated);
  };

  // Badge de estado (abierto/cerrado) compartido para ambos casos
  const statusBadge = (
    <span
      className={cn(
        "absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
        isOpen
          ? "bg-green-950/80 text-green-400 border border-green-800/60"
          : "bg-zinc-900/80 text-zinc-500 border border-zinc-700/60"
      )}
    >
      {isOpen ? t("project_card_open") : t("project_card_closed")}
    </span>
  );

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
        <div className="w-full aspect-video rounded-md overflow-hidden bg-zinc-950 relative">
          <img
            src={toAssetUrl(project.last_screenshot) ?? ""}
            alt="Last session"
            className="w-full h-full object-cover transition-all duration-300"
            style={isOpen ? undefined : { filter: "grayscale(1) brightness(0.6)" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          {statusBadge}
          {project.is_compressed && (
            <span className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-blue-950/80 text-blue-400 border border-blue-800/60">
              {t("project_card_compressed")}
            </span>
          )}
        </div>
      ) : (
        <div className="w-full aspect-video rounded-md bg-zinc-950 flex items-center justify-center text-zinc-800 border border-zinc-800/60 relative">
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.328l5.603 3.113Z" />
          </svg>
          {statusBadge}
          {project.is_compressed && (
            <span className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-blue-950/80 text-blue-400 border border-blue-800/60">
              {t("project_card_compressed")}
            </span>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-zinc-100 text-sm">{project.name}</h3>
          <p className="mt-0.5 text-xs text-zinc-500">{project.unity_version}</p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {project.is_compressed ? (
            <button
              aria-label={t("project_card_decompress")}
              onClick={handleDecompress}
              title={t("project_card_decompress")}
              className="rounded p-1.5 text-blue-500 hover:text-blue-300 hover:bg-zinc-800 transition-colors"
            >
              <PackageOpen size={14} />
            </button>
          ) : (
            <button
              aria-label={t("project_card_compress")}
              onClick={handleCompress}
              title={t("project_card_compress")}
              className="rounded p-1.5 text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 transition-colors"
            >
              <Archive size={14} />
            </button>
          )}
          <button
            aria-label={t("project_card_details")}
            onClick={(e) => { e.stopPropagation(); onDetail?.(project); }}
            className="rounded p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Info size={14} />
          </button>
          <button
            aria-label={t("project_card_delete")}
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
        {project.is_compressed && (
          <span className="rounded bg-blue-950 px-1.5 py-0.5 text-[10px] font-medium text-blue-400 flex items-center gap-1">
            <Archive size={9} /> zip
          </span>
        )}
      </div>

      {/* Botón principal: "Abrir" o "Traer al frente" */}
      <button
        aria-label={isOpen ? t("project_card_bring_to_front") : t("project_detail_open_unity")}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            tauriFocusUnityWindow(project.path).catch(console.error);
          } else {
            onOpen(project);
          }
        }}
        disabled={project.is_compressed}
        title={project.is_compressed ? t("project_card_decompress_hint") : undefined}
        className={cn(
          "mt-1 flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          isOpen
            ? "bg-green-900/40 border border-green-800/60 text-green-300 hover:bg-green-900/60"
            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
        )}
      >
        {isOpen ? <MonitorUp size={12} /> : <ExternalLink size={12} />}
        {isOpen ? t("project_card_bring_to_front") : t("project_detail_open_unity")}
      </button>

      {/* Compression popup */}
      {compressing && (
        <ProjectCompressionPopup
          projectId={project.id}
          projectName={project.name}
          mode={compressionMode}
          onDone={handleCompressionDone}
          onError={() => setCompressing(false)}
        />
      )}
    </div>
  );
}
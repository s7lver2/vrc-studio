/**
 * GlobalProjectPickerModal — selección de proyecto desde cualquier parte de la app.
 * Muestra indicador verde en proyectos con Unity en ejecución. Proyectos abiertos
 * aparecen primero en la lista.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, FolderOpen, Cpu } from "lucide-react";
import { useProjectsStore } from "@/store/projects";
import type { Project } from "@/lib/tauri";
import { tauriGetRunningUnityProjects } from "@/lib/tauri";
import type { RunningUnityProject } from "@/lib/tauri";
import { toAssetUrl } from "@/lib/utils";

interface Props {
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (project: Project, isRunning: boolean) => void;
}

export function GlobalProjectPickerModal({
  title = "Select Project",
  subtitle = "Choose a Unity project",
  onClose,
  onSelect,
}: Props) {
  const { projects, openProjectIds } = useProjectsStore();
  const [query, setQuery] = useState("");
  const [runningProjects, setRunningProjects] = useState<RunningUnityProject[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshRunning = useCallback(() => {
    tauriGetRunningUnityProjects()
      .then(setRunningProjects)
      .catch(() => setRunningProjects([]));
  }, []);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    // Primera consulta al montar
    refreshRunning();
    // Polling cada 3s mientras el modal está abierto
    const interval = setInterval(refreshRunning, 3000);
    return () => clearInterval(interval);
  }, [refreshRunning]);

  /** Normaliza una ruta a barras `/` para comparación uniforme. */
  const normPath = (p: string) => p.replace(/\\/g, "/").toLowerCase();

  /** Un proyecto se considera abierto si:
   *  - Tiene un proceso Unity corriendo con su -projectPath (detectado via sysinfo), O
   *  - El usuario lo abrió durante esta sesión (registrado en el store). */
  const isRunning = (project: Project) =>
    openProjectIds.has(project.id) ||
    runningProjects.some(
      (r) => normPath(r.project_path) === normPath(project.path)
    );

  const filtered = projects
    .filter(
      (p) =>
        !query ||
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.path.toLowerCase().includes(query.toLowerCase())
    )
    // Proyectos en ejecución primero
    .sort((a, b) => {
      const aR = isRunning(a) ? 0 : 1;
      const bR = isRunning(b) ? 0 : 1;
      return aR - bR;
    });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[75vh]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && onClose()}
              placeholder="Filtrar por nombre o ruta…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 focus:border-zinc-600 text-xs text-zinc-200 placeholder-zinc-600 outline-none transition-colors"
            />
          </div>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto p-3">
          {filtered.length === 0 && (
            <p className="text-center text-xs text-zinc-600 py-8">No hay proyectos</p>
          )}
          <div className="flex flex-col gap-1">
            {filtered.map((p) => {
              const running = isRunning(p);
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(p, running)}
                  className={[
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-left group",
                    running
                      ? "border-emerald-900/60 bg-emerald-950/20 hover:bg-emerald-950/30 hover:border-emerald-800/60"
                      : "border-transparent hover:bg-zinc-900 hover:border-zinc-800",
                  ].join(" ")}
                >
                  {/* Thumbnail */}
                  {p.last_screenshot ? (
                    <img
                      src={toAssetUrl(p.last_screenshot) ?? undefined}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
                      <FolderOpen className="h-4 w-4 text-zinc-700" />
                    </div>
                  )}

                  {/* Name + path */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-zinc-200 truncate">{p.name}</p>
                      {running && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 truncate font-mono">{p.path}</p>
                    {running && (
                      <p className="text-[9px] text-emerald-500 mt-0.5 font-medium">
                        ● Unity abierto — importará directamente
                      </p>
                    )}
                  </div>

                  {/* Unity version */}
                  {p.unity_version && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Cpu className="h-3 w-3 text-zinc-700" />
                      <span className="text-[10px] text-zinc-600">{p.unity_version}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
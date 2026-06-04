/**
 * ProjectDetailModal — rich project detail overlay.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  X, ExternalLink, FolderOpen, GitBranch,
  Monitor, Layers, Cpu, HardDrive,
  Loader2, AlertTriangle, RefreshCw, Camera,
  Info, FileSearch, Package, Download, Search,
} from "lucide-react";
import {
  Project, FileNode,
  tauriGetFileTree, tauriOpenItemLocation,
  tauriListUnityInstallations,
  tauriOpenProjectInUnity,
  tauriGetProjectEarlyImports, EarlyImportEntry,
} from "@/lib/tauri";
import { FileTreeViewer } from "@/components/inventory/FileTreeViewver";
import { VcsPanel } from "@/components/vcs/VcsPanel";
import { PackagesTab } from "@/pages/Packages";
import { listen } from "@tauri-apps/api/event";
import { toAssetUrl } from "@/lib/utils";
import { useT } from "@/i18n";

// ── helpers ───────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function formatDate(iso: string | undefined | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch { return iso; }
}

// ── Screenshot hero ───────────────────────────────────────────────────────────

function ScreenshotHero({
  project,
  onUpdated,
}: {
  project: Project;
  onUpdated: (p: Project) => void;
}) {
  const [errored, setErrored] = useState(false);
  const src = toAssetUrl(project.last_screenshot);

  useEffect(() => {
    const unlisten = listen<string>("project:screenshot_ready", (ev) => {
      if (ev.payload === project.id) {
        setErrored(false);
        onUpdated({ ...project, last_screenshot: project.last_screenshot });
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [project.id]);

  if (src && !errored) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-zinc-950" style={{ aspectRatio: "16/9" }}>
        <img
          src={src}
          alt="Last Unity session"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 px-2 py-0.5">
          <Camera className="h-2.5 w-2.5 text-zinc-400" />
          <span className="text-[9px] text-zinc-400">Last session</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-xl bg-zinc-950 border border-zinc-800 flex flex-col items-center justify-center gap-3 text-zinc-700"
      style={{ aspectRatio: "16/9" }}
    >
      <Monitor className="h-10 w-10" />
      <div className="text-center">
        <p className="text-xs font-medium text-zinc-500">No screenshot yet</p>
        <p className="text-[10px] text-zinc-700 mt-0.5">Opens automatically after you open in Unity</p>
      </div>
    </div>
  );
}

// ── Metadata badge ────────────────────────────────────────────────────────────

function Badge({ label, value, icon: Icon, accent = false }: {
  label: string;
  value: string;
  icon?: React.ElementType;
  accent?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 rounded-lg px-3 py-2",
      accent ? "bg-red-950/40 border border-red-900/40" : "bg-zinc-800/60 border border-zinc-700/30"
    )}>
      {Icon && <Icon className={cn("h-3.5 w-3.5 shrink-0", accent ? "text-red-400" : "text-zinc-500")} />}
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{label}</p>
        <p className={cn("text-xs font-medium truncate", accent ? "text-red-300" : "text-zinc-300")}>{value}</p>
      </div>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

type Tab = "overview" | "files" | "packages" | "git" | "imports";

function TabBar({ active, onSelect, vcsEnabled }: {
  active: Tab;
  onSelect: (t: Tab) => void;
  vcsEnabled: boolean;
}) {
  const t = useT();
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview",  label: t("project_detail_tab_overview"),  icon: Info },
    { id: "files",     label: t("project_detail_tab_files"),     icon: FileSearch },
    { id: "packages",  label: t("project_detail_tab_packages"),  icon: Package },
    { id: "imports",   label: "Imports",                          icon: Download },
    ...(vcsEnabled ? [{ id: "git" as Tab, label: t("project_detail_tab_git"), icon: GitBranch }] : []),
  ];

  return (
    <div className="flex items-center gap-0.5 border-b border-zinc-800 px-4 shrink-0">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px",
            active === t.id
              ? "border-red-500 text-zinc-100"
              : "border-transparent text-zinc-500 hover:text-zinc-300"
          )}
        >
          <t.icon className="h-3.5 w-3.5" />
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ project }: { project: Project }) {
  const t = useT();
  const [diskSize, setDiskSize] = useState<string | null>(null);
  const [packageCount, setPackageCount] = useState<number | null>(null);

  useEffect(() => {
    tauriGetFileTree(project.path).then((tree) => {
      const pkgsDir = tree.children?.find((c) => c.name === "Packages");
      if (pkgsDir) {
        const manifest = pkgsDir.children?.find((c) => c.name === "manifest.json");
        if (manifest?.size) {
          setPackageCount(pkgsDir.children?.filter(c => c.is_dir).length ?? null);
        }
      }
    }).catch(() => {});
  }, [project.path]);

  const shaderLabel = project.shader === "liltoon" ? "lilToon" : project.shader === "poiyomi" ? "Poiyomi" : null;

  return (
    <div className="p-5 space-y-4 overflow-y-auto flex-1">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-2">Project Path</p>
        <div className="flex items-center gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/30 px-3 py-2">
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
          <p className="text-xs text-zinc-300 break-all font-mono leading-relaxed flex-1">{project.path}</p>
          <button
            onClick={() => tauriOpenItemLocation(project.path)}
            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Open in Explorer"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-2">{t("project_detail_section_details")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Badge label={t("project_detail_badge_unity")} value={project.unity_version} icon={Cpu} />
          <Badge label={t("project_detail_badge_type")}  value={project.unity_type}    icon={Layers} />
          {shaderLabel && <Badge label={t("project_detail_badge_shader")} value={shaderLabel} icon={Monitor} accent />}
          {project.vcs_enabled && <Badge label={t("project_detail_badge_vcs")} value="Git enabled" icon={GitBranch} />}
          {packageCount !== null && (
            <Badge label={t("project_detail_badge_local_packages")} value={t("project_detail_badge_folders", { count: packageCount, s: packageCount !== 1 ? "s" : "" })} icon={Layers} />
          )}
        </div>
      </div>

      {project.avatar_base_id && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-2">Avatar Base</p>
          <Badge label={t("project_detail_badge_base_id")} value={project.avatar_base_id} icon={Monitor} />
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <p className="text-[10px] text-zinc-600 leading-relaxed">
          {t("project_detail_hint_tabs")}
        </p>
      </div>
    </div>
  );
}

// ── Files tab ─────────────────────────────────────────────────────────────────

class FilesErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle className="h-6 w-6 text-red-500" />
          <p className="text-xs text-zinc-500">Error rendering file tree</p>
          <pre className="text-[10px] text-zinc-600 bg-zinc-900 rounded p-2 max-w-full overflow-auto max-h-20">{this.state.error}</pre>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5 transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function FilesTab({ project }: { project: Project }) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    tauriGetFileTree(project.path)
      .then((result) => {
        console.log("[FilesTab] file tree loaded, root:", result?.name, "children:", result?.children?.length);
        setTree(result);
      })
      .catch((e) => {
        console.error("[FilesTab] get_file_tree error:", e);
        setError(String(e));
      })
      .finally(() => setLoading(false));
  }, [project.path]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Loader2 className="h-3 w-3 animate-spin text-zinc-600" />
            <span className="text-[10px] text-zinc-600">Reading project directory…</span>
          </div>
          <div className="h-1 rounded-full bg-zinc-800 overflow-hidden relative">
            <div
              className="absolute inset-y-0 w-2/5 rounded-full bg-red-600/60"
              style={{ animation: "files-slide 1.4s ease-in-out infinite" }}
            />
          </div>
        </div>
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2.5 animate-pulse" style={{ opacity: 1 - i * 0.06 }}>
            <div className="h-3 w-3 rounded bg-zinc-800 shrink-0" style={{ marginLeft: `${(i % 4) * 14}px` }} />
            <div className="h-2 rounded bg-zinc-800" style={{ width: `${38 + ((i * 41) % 45)}%` }} />
          </div>
        ))}
        <style>{`@keyframes files-slide { 0% { left:-40% } 100% { left:100% } }`}</style>
      </div>
    );
  }

  if (error || !tree) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
        <AlertTriangle className="h-6 w-6 text-red-500" />
        <p className="text-xs text-zinc-500 font-medium">Could not read project directory</p>
        {error && (
          <pre className="text-[10px] text-zinc-600 bg-zinc-900 rounded p-2 max-w-full overflow-auto max-h-24 text-left">{error}</pre>
        )}
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-3 py-1.5 transition-colors"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }

  return (
    <FilesErrorBoundary key={key} onReset={() => { setKey((k) => k + 1); load(); }}>
      <div className="flex-1 overflow-y-auto p-4">
        <FileTreeViewer root={tree} maxH="max-h-full" showFilterToggle defaultFiltered />
      </div>
    </FilesErrorBoundary>
  );
}

// ── Imports tab ───────────────────────────────────────────────────────────────

function ImportsTab({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<EarlyImportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "done" | "pending">("all");

  useEffect(() => {
    setLoading(true);
    tauriGetProjectEarlyImports(projectId)
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ project_id: string; status: string }>("early_import_progress", (ev) => {
      if (ev.payload.project_id === projectId && ev.payload.status === "complete") {
        tauriGetProjectEarlyImports(projectId).then(setEntries).catch(() => {});
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [projectId]);

  const statusFiltered = entries.filter((e) => {
    if (statusTab === "done") return e.status === "done";
    if (statusTab === "pending") return e.status === "pending" || e.status === "error";
    return true;
  });

  const textFiltered = statusFiltered.filter((e) =>
    e.item_name.toLowerCase().includes(filter.toLowerCase())
  );

  const doneCount    = entries.filter((e) => e.status === "done").length;
  const pendingCount = entries.filter((e) => e.status !== "done").length;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-600 py-10">
        <Package className="h-8 w-8" />
        <p className="text-sm">No hay Early Imports para este proyecto</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <Search className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
            placeholder="Filtrar…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-1.5">
        {([
          { id: "all",     label: `Todos (${entries.length})` },
          { id: "done",    label: `✓ Importados (${doneCount})` },
          { id: "pending", label: `⏳ Pendientes (${pendingCount})` },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusTab(tab.id)}
            className="text-[10px] px-2.5 py-1 rounded-md transition-colors"
            style={statusTab === tab.id
              ? { background: "rgba(220,38,38,.1)", color: "#f87171", border: "1px solid rgba(220,38,38,.2)" }
              : { background: "#18181b", color: "#52525b", border: "1px solid #27272a" }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2.5">
        {textFiltered.map((entry) => {
          const cover = entry.thumbnail_url
            ? (entry.thumbnail_url.startsWith("http") ? entry.thumbnail_url : toAssetUrl(entry.thumbnail_url))
            : null;
          const statusColor = entry.status === "done" ? "#16a34a" : entry.status === "error" ? "#dc2626" : "#f59e0b";
          const statusIcon  = entry.status === "done" ? "✓" : entry.status === "error" ? "✕" : "⏳";
          return (
            <div key={entry.id} className="flex flex-col items-center gap-1.5">
              <div
                className="relative w-full aspect-square rounded-xl overflow-hidden border-2"
                style={{ borderColor: entry.status === "done" ? "#16a34a40" : "#27272a" }}
                title={entry.error_msg ?? undefined}
              >
                {cover ? (
                  <img src={cover} alt={entry.item_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                    <Package className="h-5 w-5 text-zinc-700" />
                  </div>
                )}
                <div
                  className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] text-white font-bold"
                  style={{ background: statusColor }}
                >
                  {statusIcon}
                </div>
              </div>
              <p className="text-[9px] text-zinc-500 text-center leading-tight line-clamp-2 w-full px-0.5">
                {entry.item_name}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

interface Props {
  project: Project;
  onClose: () => void;
  onDelete: (project: Project) => void;
  onUpdated: (project: Project) => void;
}

export function ProjectDetailModal({ project, onClose, onDelete, onUpdated }: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("overview");
  const [opening, setOpening] = useState(false);
  const [manualUnityPath, setManualUnityPath] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  const handleOpen = async () => {
    setOpening(true);
    try {
      const installations = await tauriListUnityInstallations().catch(() => []);
      let match = installations.find((i) => i.version === project.unity_version);

      if (!match && manualUnityPath) {
        match = { version: project.unity_version, path: manualUnityPath, is_custom: true };
      }

      if (!match) {
        setShowManualInput(true);
        return;
      }
      await tauriOpenProjectInUnity(project.id, project.path, match.path);
    } finally {
      setOpening(false);
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div className="relative flex w-full max-w-5xl h-[80vh] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Left panel */}
        <div className="w-80 shrink-0 flex flex-col gap-4 border-r border-zinc-800 p-5 overflow-y-auto">
          <ScreenshotHero project={project} onUpdated={onUpdated} />
          <div>
            <h2 className="text-base font-bold text-zinc-100 leading-tight">{project.name}</h2>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono truncate">{project.unity_version}</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Cpu className="h-3.5 w-3.5 text-zinc-600" />
              <span>{project.unity_version}</span>
            </div>
            {project.shader && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Layers className="h-3.5 w-3.5 text-zinc-600" />
                <span>{project.shader === "liltoon" ? "lilToon" : "Poiyomi"} shader</span>
              </div>
            )}
            {project.vcs_enabled && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <GitBranch className="h-3.5 w-3.5 text-zinc-600" />
                <span>Git repository</span>
              </div>
            )}
          </div>

          <button
            onClick={handleOpen}
            disabled={opening}
            className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {t("project_detail_open_unity")}
          </button>

          {showManualInput && (
            <div className="mt-3 p-3 bg-zinc-900 rounded-lg border border-yellow-800">
              <p className="text-xs text-yellow-400 mb-2">
                {t("project_detail_unity_missing", { version: project.unity_version })}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="C:\Program Files\Unity\Hub\Editor\2022.3.22f1\Editor\Unity.exe"
                  value={manualUnityPath ?? ""}
                  onChange={(e) => setManualUnityPath(e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 font-mono"
                />
                <button
                  onClick={async () => {
                    if (!manualUnityPath) return;
                    setShowManualInput(false);
                    setOpening(true);
                    try {
                      await tauriOpenProjectInUnity(project.id, project.path, manualUnityPath);
                    } finally {
                      setOpening(false);
                    }
                  }}
                  className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-zinc-200"
                >
                  {t("project_detail_open_unity")}
                </button>
              </div>
              <p className="text-[10px] text-zinc-600 mt-1">{t("project_detail_logs_hint")}</p>
            </div>
          )}

          <button
            onClick={() => tauriOpenItemLocation(project.path)}
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("project_detail_open_folder")}
          </button>

          <div className="mt-auto pt-2 border-t border-zinc-800">
            <button
              onClick={() => onDelete(project)}
              className="w-full text-left text-xs text-zinc-700 hover:text-red-400 transition-colors py-1"
            >
              {t("project_detail_delete")}
            </button>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex flex-col flex-1 min-w-0">
          <TabBar active={tab} onSelect={setTab} vcsEnabled={project.vcs_enabled} />
          <div className={tab === "overview" ? "contents" : "hidden"}>
            <OverviewTab project={project} />
          </div>
          <div className={tab === "files" ? "contents" : "hidden"}>
            <FilesTab project={project} />
          </div>
          <div className={tab === "packages" ? "flex-1 flex flex-col overflow-hidden" : "hidden"}>
            <PackagesTab project={project} />
          </div>
          <div className={tab === "imports" ? "flex-1 flex flex-col overflow-hidden min-h-0" : "hidden"}>
            <ImportsTab projectId={project.id} />
          </div>
          {project.vcs_enabled && (
            <div className={tab === "git" ? "flex-1 overflow-hidden" : "hidden"}>
              <VcsPanel projectPath={project.path} />
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-7 w-7 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
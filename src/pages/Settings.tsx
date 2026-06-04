import Logs from "./Logs";
import { StorageCompressionSection } from "@/components/settings/StorageCompressionSection";
import { ConnectionHub } from "@/components/settings/ConnectionsHub";
import React, { useState, useCallback, useEffect } from "react";
import {
  Globe, Tags, Save, Check,
  RefreshCw, Package, Plus, Upload,
  Loader2, AlertTriangle, CheckCircle2,
  Trash2, ExternalLink, ChevronRight,
  Settings as SettingsIcon, Bug,
  Archive, Download, Shield, Wifi, Palette,
  Lock, FolderOpen, Terminal, FileText, Play,
  LogOut, X, FlaskConical
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CompressionSection } from "@/components/settings/CompressionSection";
import {
  tauriPing,
  tauriFetchVpmRepo,
  tauriGetAppSettings,
  tauriSetAppSettings,
  VpmPackage,
  tauriExportDatabase,
  tauriImportDatabase,
  github, GithubUserInfo,
} from "@/lib/tauri";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import { useT, useLocale, setLocale, Locale } from "@/i18n";
import { useTagStore, BehaviorSlot } from "@/store/tagStore";
import { useAppStore } from "@/store/app";
import { UpdateSettingsPanel } from "@/components/settings/UpdateSettingsPanel";
import { invoke } from "@tauri-apps/api/core";
import { useInventoryStore } from "@/store/inventoryStore";
import { AppearanceSection } from "@/components/settings/AppearanceSection";

// ── helpers ───────────────────────────────────────────────────────────────────

// ── Integration tile types ────────────────────────────────────────────────────

type IntegrationStatus = "connected" | "disconnected" | "unknown";

type Integration = {
  id: string;
  name: string;
  logo: React.ReactNode;  // SVG o emoji
  status: IntegrationStatus;
  requiresDevCode: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  detailContent?: React.ReactNode; // Contenido del modal de detalle
};

function IntegrationTile({
  integration,
  isLocked,
  onLockedClick,
}: {
  integration: Integration;
  isLocked: boolean;
  onLockedClick: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const isConnected = integration.status === "connected";

  const handleClick = () => {
    if (isLocked && integration.requiresDevCode) {
      onLockedClick();
      return;
    }
    if (isConnected) {
      setShowDetail(true);
    } else {
      integration.onConnect();
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        className="relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all group"
        style={{
          width: 80,
          border: isConnected
            ? "1.5px solid rgba(52, 211, 153, 0.4)"
            : "1.5px solid #27272a",
          background: isConnected
            ? "radial-gradient(ellipse at 50% 120%, rgba(52,211,153,0.12) 0%, #09090b 70%)"
            : "#18181b",
          boxShadow: isConnected
            ? "0 0 16px rgba(52, 211, 153, 0.15), inset 0 0 12px rgba(52,211,153,0.05)"
            : "none",
        }}
        title={integration.requiresDevCode && isLocked ? "Requiere código de desarrollador" : integration.name}
      >
        {/* Logo */}
        <div
          className="relative w-10 h-10 rounded-xl flex items-center justify-center"
          style={{
            filter: isLocked && integration.requiresDevCode ? "blur(3px)" : "none",
          }}
        >
          {integration.logo}
        </div>

        {/* Name */}
        <span
          className="text-[9px] font-semibold text-center leading-tight"
          style={{
            color: isConnected ? "#34d399" : "#71717a",
            filter: isLocked && integration.requiresDevCode ? "blur(2px)" : "none",
          }}
        >
          {integration.name}
        </span>

        {/* Status dot */}
        {isConnected && (
          <div
            className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400"
            style={{ boxShadow: "0 0 6px rgba(52, 211, 153, 0.8)" }}
          />
        )}

        {/* Lock overlay para integraciones protegidas */}
        {isLocked && integration.requiresDevCode && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl">
            <div className="w-7 h-7 rounded-lg bg-zinc-900/80 border border-zinc-700 flex items-center justify-center">
              <Lock className="h-3.5 w-3.5 text-zinc-400" />
            </div>
          </div>
        )}
      </button>

      {/* Detail modal */}
      {showDetail && (
        <IntegrationDetailModal
          integration={integration}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}

function IntegrationDetailModal({
  integration,
  onClose,
}: {
  integration: Integration;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[420px] rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center">
            {integration.logo}
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-zinc-100">{integration.name}</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 4px rgba(52,211,153,0.8)" }} />
              <p className="text-[10px] text-emerald-400 font-semibold">Conectado</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {integration.detailContent ?? (
            <p className="text-xs text-zinc-500">Sin información adicional disponible.</p>
          )}
        </div>

        {/* Disconnect */}
        <div className="px-6 pb-5 flex justify-end">
          <button
            onClick={() => { integration.onDisconnect(); onClose(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-red-900/40 bg-red-950/20 text-red-400 text-xs font-medium hover:bg-red-950/40 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" /> Desconectar
          </button>
        </div>
      </div>
    </div>
  );
}

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/** Card contenedor unificado */
function SettingsCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden", className)}>
      {children}
    </div>
  );
}

/** Fila dentro de un card con separador */
function CardRow({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("px-5 py-4", !last && "border-b border-zinc-800/80")}>
      {children}
    </div>
  );
}

/** Toggle interruptor */
function Toggle({
  value,
  onChange,
  accent = "violet",
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  accent?: "violet" | "blue" | "amber";
}) {
  const colors: Record<string, string> = {
    violet: "bg-violet-600 border-violet-500/60",
    blue: "bg-blue-600 border-blue-500/60",
    amber: "bg-amber-600 border-amber-500/60",
  };
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={cn(
        "relative flex-shrink-0 w-11 h-6 rounded-full border transition-all duration-200",
        value ? colors[accent] : "bg-zinc-800 border-zinc-700"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-200",
          value ? "left-[calc(100%-22px)]" : "left-0.5"
        )}
      />
    </button>
  );
}

/** Label de categoría en el sidebar */
function SidebarGroup({ label }: { label: string }) {
  return (
    <p className="px-3 pt-6 pb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600 select-none">
      {label}
    </p>
  );
}

/** Header de sección en el content */
function SectionHeader({
  icon: _Icon, // keep prop for compat but don't render the box
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-7">
      <h2 className="text-lg font-semibold tracking-tight text-zinc-100 mb-1">{title}</h2>
      <p className="text-sm text-zinc-500 leading-relaxed">{description}</p>
    </div>
  );
}

// ── VPM Source store (frontend-only) ──────────────────────────────────────────

interface VpmSource {
  id: string;
  name: string;
  url: string;
  packageCount?: number;
  isOfficial?: boolean;
}

function SettingsField({
  name,
  desc,
  children,
}: {
  name: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-3.5 border-b border-zinc-800/60 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-zinc-100">{name}</div>
        <div className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{desc}</div>
      </div>
      <div className="flex-shrink-0 w-44">{children}</div>
    </div>
  );
}

const OFFICIAL_SOURCE: VpmSource = {
  id: "official",
  name: "VRChat Official",
  url: "https://packages.vrchat.com/curated?download",
  isOfficial: true,
};

function useVpmSources() {
  const [sources, setSources] = useState<VpmSource[]>(() => {
    try {
      const saved = localStorage.getItem("vpm_sources");
      return saved ? JSON.parse(saved) : [OFFICIAL_SOURCE];
    } catch {
      return [OFFICIAL_SOURCE];
    }
  });

  const save = (next: VpmSource[]) => {
    setSources(next);
    try { localStorage.setItem("vpm_sources", JSON.stringify(next)); } catch { }
    // Sync non-official URLs to backend AppSettings so fetch_vpm_index picks them up
    const extraUrls = next
      .filter((s) => !s.isOfficial)
      .map((s) => s.url)
      .filter(Boolean);
    tauriGetAppSettings()
      .then((current) =>
        tauriSetAppSettings({ ...current, extra_vpm_sources: extraUrls })
      )
      .catch(console.error);
  };

  return {
    sources,
    addSource: (src: VpmSource) => save([...sources, src]),
    addSources: (s: VpmSource[]) => save([...sources, ...s]),
    removeSource: (id: string) => save(sources.filter((s) => s.id !== id)),
  };
}

// ── Add by URL modal ──────────────────────────────────────────────────────────

function AddUrlModal({ onClose, onAdd }: { onClose: () => void; onAdd: (s: VpmSource) => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<VpmPackage[] | null>(null);
  const [repoName, setRepoName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(null); setPreview(null);
    try {
      const pkgs = await tauriFetchVpmRepo(url.trim());
      setPreview(pkgs);
      try { setRepoName(new URL(url.trim()).hostname.replace(/^www\./, "")); } catch { }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    if (!preview) return;
    onAdd({ id: crypto.randomUUID(), name: repoName || url, url: url.trim(), packageCount: preview.length });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-5 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{t("settings_add_from_url_title")}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{t("settings_add_from_url_desc")}</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-4 shrink-0 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 flex flex-col gap-4 px-6 py-5 overflow-y-auto">
          <div className="flex gap-2">
            <input
              type="url" value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handlePreview(); }}
              placeholder="https://example.com/index.json"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-3 py-2 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
              autoFocus
            />
            <button
              onClick={handlePreview} disabled={!url.trim() || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors disabled:opacity-40 shrink-0 border border-zinc-700"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Preview
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {preview && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 block">{t("settings_source_name")}</label>
                <input
                  type="text" value={repoName} onChange={(e) => setRepoName(e.target.value)}
                  placeholder="e.g. My Custom Repo"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-3 py-1.5 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {t("settings_preview_label")} ({preview.length})
                  </p>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> {t("settings_preview_valid")}
                  </span>
                </div>
                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                  {preview.slice(0, 50).map((pkg) => {
                    const latest = Object.values(pkg.versions)[0];
                    return (
                      <div key={pkg.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50">
                        <Package className="h-3 w-3 text-zinc-600 shrink-0" />
                        <p className="text-xs text-zinc-300 truncate flex-1">{latest?.display_name || pkg.id}</p>
                        <span className="text-[10px] text-zinc-600 font-mono shrink-0">{latest?.version}</span>
                      </div>
                    );
                  })}
                  {preview.length > 50 && <p className="text-center text-[10px] text-zinc-600 py-1">+{preview.length - 50} more…</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-zinc-800 px-6 py-4 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
            {t("settings_cancel")}
          </button>
          <button
            onClick={handleAdd} disabled={!preview || !url.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> {t("settings_add_source")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import VCC modal ──────────────────────────────────────────────────────────

interface ImportedVccSource { name: string; url: string; selected: boolean; }

function ImportVccModal({ onClose, onImport }: { onClose: () => void; onImport: (s: ImportedVccSource[]) => void }) {
  const t = useT();
  const [sources, setSources] = useState<ImportedVccSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState(false);

  const handleBrowse = async () => {
    const result = await openDialog({ title: "Select VCC / alcom settings file", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!result || typeof result !== "string") return;
    setLoading(true); setError(null);
    try {
      const content = await invoke<string>("read_file_as_string", { path: result });
      const json = JSON.parse(content);
      const userRepos: any[] = json.userRepos ?? json.UserRepos ?? json.repos ?? [];
      const discovered: ImportedVccSource[] = userRepos
        .map((r: any) => ({ name: r.name ?? r.Name ?? r.localPath ?? r.url ?? "Unknown", url: r.url ?? r.URL ?? r.localPath ?? "", selected: true }))
        .filter((r) => r.url);
      if (discovered.length === 0) {
        setError("No VPM sources found in this file.");
      } else {
        setSources(discovered); setParsed(true);
      }
    } catch (e) {
      setError(`Could not parse file: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (i: number) => setSources((prev) => prev.map((s, j) => (j === i ? { ...s, selected: !s.selected } : s)));
  const selectedCount = sources.filter((s) => s.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col max-h-[75vh]">
        <div className="flex items-start justify-between border-b border-zinc-800 px-6 py-5 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{t("settings_import_vcc_title")}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{t("settings_import_vcc_desc")}</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors ml-4 text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {!parsed ? (
            <>
              <div className="flex flex-col gap-1.5 text-xs text-zinc-500 bg-zinc-900 rounded-lg p-3 border border-zinc-800">
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide font-medium mb-0.5">VCC</p>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span className="font-mono text-zinc-400">%APPDATA%\VRChatCreatorCompanion\settings.json</span>
                </div>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span className="font-mono text-zinc-400">%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json</span>
                </div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide font-medium mt-1.5 mb-0.5">alcom</p>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span className="font-mono text-zinc-400">%LOCALAPPDATA%\AlcomByVRCGet\settings.json</span>
                </div>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span className="font-mono text-zinc-400">%APPDATA%\AlcomByVRCGet\settings.json</span>
                </div>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span className="font-mono text-zinc-400">%APPDATA%\vrc-get\settings.json</span>
                </div>
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
              <button
                onClick={handleBrowse}
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 px-4 py-3 text-sm text-zinc-200 transition-colors disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t("settings_import_browse")}
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-zinc-400">{t("settings_import_select")}:</p>
              <div className="flex flex-col gap-1.5">
                {sources.map((src, i) => (
                  <button
                    key={i} onClick={() => toggle(i)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      src.selected ? "border-violet-500/50 bg-violet-500/8" : "border-zinc-700/50 bg-zinc-900/50"
                    )}
                  >
                    <div className={cn("mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors", src.selected ? "bg-violet-600 border-violet-600" : "border-zinc-600 bg-zinc-800")}>
                      {src.selected && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-200 truncate">{src.name}</p>
                      <p className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">{src.url}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {parsed && (
          <div className="flex justify-end gap-2.5 border-t border-zinc-800 px-6 py-4 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">{t("settings_cancel")}</button>
            <button
              onClick={() => { onImport(sources.filter((s) => s.selected)); onClose(); }}
              disabled={selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" /> Import {selectedCount}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Packages section ──────────────────────────────────────────────────────────

function PackagesSection() {
  const t = useT();
  const { sources, addSources, removeSource } = useVpmSources();
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [importVccOpen, setImportVccOpen] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, { count: number } | { error: string }>>({});

  const checkSource = async (src: VpmSource) => {
    setCheckingId(src.id);
    try {
      const pkgs = await tauriFetchVpmRepo(src.url);
      setCheckResults((prev) => ({ ...prev, [src.id]: { count: pkgs.length } }));
    } catch (e) {
      setCheckResults((prev) => ({ ...prev, [src.id]: { error: String(e) } }));
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <>
      {addUrlOpen && <AddUrlModal onClose={() => setAddUrlOpen(false)} onAdd={(s) => { addSources([s]); setAddUrlOpen(false); }} />}
      {importVccOpen && <ImportVccModal onClose={() => setImportVccOpen(false)} onImport={(imported) => addSources(imported.map((s) => ({ id: crypto.randomUUID(), name: s.name, url: s.url })))} />}

      <SectionHeader icon={Package} title={t("settings_packages_title")} description={t("settings_packages_desc")} />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("settings_vpm_sources_label")} ({sources.length})</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setImportVccOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors">
              <Upload className="h-3 w-3" /> {t("settings_vpm_import_vcc")}
            </button>
            <button onClick={() => setAddUrlOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs text-white font-medium transition-colors">
              <Plus className="h-3 w-3" /> {t("settings_vpm_add_url")}
            </button>
          </div>
        </div>

        <SettingsCard>
          {sources.map((src, idx) => {
            const result = checkResults[src.id];
            const isChecking = checkingId === src.id;
            return (
              <CardRow key={src.id} last={idx === sources.length - 1}>
                <div className="flex items-center gap-3">
                  <div className={cn("h-9 w-9 rounded-xl flex items-center justify-center shrink-0 border", src.isOfficial ? "bg-violet-950/60 border-violet-900/40" : "bg-zinc-800 border-zinc-700")}>
                    <Package className={cn("h-4 w-4", src.isOfficial ? "text-violet-400" : "text-zinc-500")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-200 truncate">{src.name}</p>
                      {src.isOfficial && (
                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider bg-violet-950/60 border border-violet-900/40 text-violet-400 px-1.5 py-0.5 rounded">
                          {t("settings_source_official")}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">{src.url}</p>
                    {result && (
                      <p className={cn("text-[10px] mt-0.5", "error" in result ? "text-red-400" : "text-emerald-400")}>
                        {"error" in result ? `✗ ${result.error}` : `✓ ${result.count} ${t("settings_source_packages")}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => checkSource(src)} disabled={isChecking} title={t("settings_source_test")}
                      className="h-8 w-8 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40"
                    >
                      {isChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </button>
                    {!src.isOfficial && (
                      <button
                        onClick={() => removeSource(src.id)} title={t("settings_source_remove")}
                        className="h-8 w-8 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-900/60 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </CardRow>
            );
          })}
        </SettingsCard>
      </div>
    </>
  );
}

// ── General section ───────────────────────────────────────────────────────────

const LOCALE_OPTIONS: { value: Locale; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "es", label: "Español", flag: "🇪🇸" },
  { value: "de", label: "Deutsch", flag: "🇩🇪" },
];

function GeneralSection() {
  const t = useT();
  const locale = useLocale();
  const { behaviorLabels, setBehaviorLabel } = useTagStore();
  const [draft, setDraft] = useState({ ...behaviorLabels });
  const [saved, setSaved] = useState(false);
  const handleSave = () => {
    (Object.keys(draft) as BehaviorSlot[]).forEach((slot) => {
      if (draft[slot] !== behaviorLabels[slot]) setBehaviorLabel(slot, draft[slot]);
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const slots: { slot: BehaviorSlot; labelKey: "settings_behavior_base" | "settings_behavior_outfit" | "settings_behavior_accessory"; descKey: "settings_behavior_base_desc" | "settings_behavior_outfit_desc" | "settings_behavior_accessory_desc"; color: string }[] = [
    { slot: "base", labelKey: "settings_behavior_base", descKey: "settings_behavior_base_desc", color: "text-amber-400" },
    { slot: "outfit", labelKey: "settings_behavior_outfit", descKey: "settings_behavior_outfit_desc", color: "text-pink-400" },
    { slot: "accessory", labelKey: "settings_behavior_accessory", descKey: "settings_behavior_accessory_desc", color: "text-violet-400" },
  ];

  return (
    <>
      <SectionHeader icon={SettingsIcon} title="General" description={t("settings_general_desc")} />

      <div className="flex flex-col gap-6">
        {/* Language — banderas grandes como selector primario */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" /> {t("settings_language")}
          </p>
          <div className="flex gap-2">
            {LOCALE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLocale(opt.value)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-2 py-4 rounded-2xl border-2 transition-all duration-200",
                  locale === opt.value
                    ? "border-violet-500 bg-violet-950/40 shadow-[0_0_16px_rgba(139,92,246,0.2)]"
                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/60"
                )}
              >
                <span className="text-3xl leading-none">{opt.flag}</span>
                <span className={cn(
                  "text-xs font-semibold",
                  locale === opt.value ? "text-violet-300" : "text-zinc-500"
                )}>
                  {opt.label}
                </span>
                {locale === opt.value && (
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Behaviour labels — chips de color con input inline */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Tags className="h-3.5 w-3.5" /> {t("settings_behavior_labels")}
          </p>
          <div className="flex flex-col gap-2">
            {slots.map(({ slot, labelKey, descKey, color }) => (
              <div
                key={slot}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-900 group hover:border-zinc-700 transition-colors"
              >
                {/* Color dot */}
                <div className={cn("w-3 h-3 rounded-full shrink-0", color.replace("text-", "bg-"))} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-300">{t(labelKey)}</p>
                  <p className="text-[10px] text-zinc-600 mt-0.5">{t(descKey)}</p>
                </div>
                {/* Preview badge con el valor actual */}
                <div className={cn(
                  "shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border",
                  color, color.replace("text-", "bg-") + "/10",
                  color.replace("text-", "border-") + "/30"
                )}>
                  {draft[slot]}
                </div>
                {/* Input inline (aparece al hover) */}
                <input
                  className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 outline-none focus:border-zinc-500 font-mono transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                  value={draft[slot]}
                  onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
          {/* Save button */}
          <button
            onClick={handleSave}
            className={cn(
              "self-start flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
              saved
                ? "bg-emerald-700/20 border-emerald-500/40 text-emerald-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
            )}
          >
            {saved ? <><Check className="h-3.5 w-3.5" /> {t("settings_saved")}</> : <><Save className="h-3.5 w-3.5" /> Save</>}
          </button>
        </div>

      </div>
    </>
  );
}

// ── Updates section ───────────────────────────────────────────────────────────

function UpdatesSection() {
  const t = useT();
  return (
    <>
      <SectionHeader icon={Download} title={t("settings_updates_title")} description={t("settings_updates_desc")} />
      <UpdateSettingsPanel />
    </>
  );
}

function LogsSection() {
  const t = useT();
  return (
    <>
      <SectionHeader icon={Terminal} title={t("settings_logs_title")} description={t("settings_logs_desc")} />
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        <Logs embedded />
      </div>
    </>
  );
}

// ── Compression section ───────────────────────────────────────────────────────

function CompressionSectionWrapper() {
  const t = useT();
  return (
    <>
      <SectionHeader icon={Archive} title={t("compression_section_title")} description={t("compression_section_desc")} />
      <CompressionSection />
    </>
  );
}

// ── Debug section ─────────────────────────────────────────────────────────────

interface ReimportResult { item_id: string; name: string; status: "ok" | "skipped" | "error"; message: string; }

function DebugSection() {
  const t = useT();
  const { fetchAll: fetchInventory, addDebugItems, clearDebugItems } = useInventoryStore();
  const { openGetStarted } = useAppStore();
  const [pingResponse, setPingResponse] = useState<string | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

  // reimport state
  const [reimportState, setReimportState] = useState<"idle" | "running" | "done">("idle");
  const [reimportResults, setReimportResults] = useState<ReimportResult[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  // reset folder assignments state
  const [resettingFolders, setResettingFolders] = useState(false);
  const [resetFolderResult, setResetFolderResult] = useState<string | null>(null);

  // fake items state
  const [fakeCount, setFakeCount] = useState(10);
  const [fakeGenerated, setFakeGenerated] = useState(false);

  const FAKE_NAMES = [
    "Yomu Avatar", "Karin Outfit", "Shadow Veil", "Tsuki Base", "Crystal Wings",
    "Neko Ears Pack", "Synth Shader", "Aurora Hair", "Phantom Tail", "Vox Accessory",
    "Stellar Dress", "Void Cloak", "Bloom Particle", "Ryuu Scale", "Mochi Paws",
    "Echo Visor", "Drift Jacket", "Hana Kimono", "Lunar Belt", "Prism Horns",
  ];
  const FAKE_AUTHORS = ["yoshino", "mika_dev", "rei.studio", "suzuri_arts", "akaneko", "booth_official"];
  const FAKE_TAGS = ["base", "outfit", "accessory", "avatar", "shader", "material", "hair", "tail", "ears", "wings"];
  const FAKE_THUMBS = [
    "https://picsum.photos/seed/a/200/200",
    "https://picsum.photos/seed/b/200/200",
    "https://picsum.photos/seed/c/200/200",
    "https://picsum.photos/seed/d/200/200",
    "https://picsum.photos/seed/e/200/200",
  ];

  const generateFakeItems = () => {
    const newItems = Array.from({ length: fakeCount }, (_, i) => {
      const name = FAKE_NAMES[Math.floor(Math.random() * FAKE_NAMES.length)];
      return {
        id: `debug_${crypto.randomUUID()}`,
        name: `${name} #${i + 1}`,
        display_name: `${name} #${i + 1}`,
        author: FAKE_AUTHORS[Math.floor(Math.random() * FAKE_AUTHORS.length)],
        source: "local" as const,
        source_id: null,
        local_path: "/debug/fake",
        thumbnail_url: FAKE_THUMBS[i % FAKE_THUMBS.length],
        download_date: new Date().toISOString(),
        size_bytes: Math.floor(Math.random() * 200_000_000) + 5_000_000,
        tags: FAKE_TAGS.sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 3) + 1),
        is_compressed: false,
        custom_cover_path: null,
        sort_order: null,
        product_images: [],
        custom_images: [],
        folder_id: null,
      };
    });
    addDebugItems(newItems);
    setFakeGenerated(true);
  };

  const clearFakeItems = () => {
    clearDebugItems();
    setFakeGenerated(false);
  };

  const handlePing = async () => {
    setPingResponse(null); setPingError(null);
    try {
      const res = await tauriPing("vrc-studio");
      setPingResponse(res);
    } catch (e) {
      setPingError(String(e));
    }
  };

  const handleReimportConfirm = async () => {
    setShowConfirm(false);
    setReimportState("running");
    setReimportResults([]);
    try {
      const results = await invoke<ReimportResult[]>("reimport_all_assets");
      setReimportResults(results);
      if (results.some((r) => r.status === "ok")) {
        await fetchInventory();
      }
    } catch (e) {
      setReimportResults([{ item_id: "", name: "", status: "error", message: String(e) }]);
    } finally {
      setReimportState("done");
    }
  };

  const handleResetFolderAssignments = async () => {
    setResettingFolders(true);
    setResetFolderResult(null);
    try {
      await invoke("reset_all_folder_assignments");
      useInventoryStore.setState((s) => ({
        items: s.items.map((i) => ({ ...i, folder_id: null })),
      }));
      setResetFolderResult("All items moved back to root.");
    } catch (e) {
      setResetFolderResult(`Error: ${String(e)}`);
    } finally {
      setResettingFolders(false);
    }
  };

  const ok = reimportResults.filter((r) => r.status === "ok").length;
  const skipped = reimportResults.filter((r) => r.status === "skipped").length;
  const errors = reimportResults.filter((r) => r.status === "error").length;

  return (
    <>
      {/* Confirm dialog for reimport */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 shrink-0">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-100">Reimport all assets?</p>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  The extracted files of every item will be deleted and re-extracted from their source archive.
                  Metadata (name, author, tags) is preserved. Items without a source archive will be skipped.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReimportConfirm}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-sm font-medium text-white transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reimport all
              </button>
            </div>
          </div>
        </div>
      )}

      <SectionHeader icon={Bug} title={t("settings_debug_title")} description={t("settings_debug_desc")} />
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("settings_debug")}</p>
        <SettingsCard>
          {/* Restart with Get Started */}
          <CardRow>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Restart with Get Started</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Replay the first-launch tutorial that guides you through all sections.
                </p>
              </div>
              <button
                onClick={openGetStarted}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600"
              >
                <Play className="h-3.5 w-3.5" /> Launch
              </button>
            </div>
          </CardRow>

          {/* Restart app */}
          <CardRow>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Restart app</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Close and relaunch VRC Studio immediately.
                </p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Reload UI
              </button>
            </div>
          </CardRow>

          {/* Ping */}
          <CardRow>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">{t("settings_test_ipc")}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Tauri IPC bridge round-trip test</p>
              </div>
              <button onClick={handlePing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600">
                <Shield className="h-3.5 w-3.5" /> Ping
              </button>
            </div>
            {(pingResponse || pingError) && (
              <div className={cn("mt-3 rounded-lg px-3 py-2 text-xs font-mono", pingResponse ? "bg-emerald-950/40 border border-emerald-900/50 text-emerald-300" : "bg-red-950/40 border border-red-900/50 text-red-300")}>
                {pingResponse ? `✓ ${pingResponse}` : `✗ ${pingError}`}
              </div>
            )}
          </CardRow>

          {/* Reimport all assets */}
          <CardRow>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Reimport all assets</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Delete and re-extract every item from its source archive. Metadata is kept.
                </p>
              </div>
              <button
                onClick={() => { setReimportState("idle"); setReimportResults([]); setShowConfirm(true); }}
                disabled={reimportState === "running"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {reimportState === "running"
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
                {reimportState === "running" ? "Running…" : "Run"}
              </button>
            </div>

            {reimportState !== "idle" && (
              <div className="mt-3 flex flex-col gap-2">
                {reimportState === "done" && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" />{ok} ok</span>
                    <span className="flex items-center gap-1 text-zinc-500"><Package className="h-3.5 w-3.5" />{skipped} skipped</span>
                    {errors > 0 && <span className="flex items-center gap-1 text-red-400"><AlertTriangle className="h-3.5 w-3.5" />{errors} error{errors !== 1 ? "s" : ""}</span>}
                  </div>
                )}
                {reimportResults.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800/60 max-h-52 overflow-y-auto">
                    {reimportResults.map((r, i) => (
                      <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                        <span className={cn("shrink-0 mt-0.5 text-[10px] font-bold uppercase w-12 text-right",
                          r.status === "ok" && "text-emerald-400",
                          r.status === "skipped" && "text-zinc-500",
                          r.status === "error" && "text-red-400",
                        )}>{r.status}</span>
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-200 truncate">{r.name || "—"}</p>
                          <p className="text-[10px] text-zinc-600 truncate">{r.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {reimportState === "running" && reimportResults.length === 0 && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing items…
                  </div>
                )}
              </div>
            )}
          </CardRow>

          {/* Reset folder assignments */}
          <CardRow last>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Reset folder assignments</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Move all inventory items back to the root (clear folder_id). Use this if items are not showing up.
                </p>
              </div>
              <button
                onClick={handleResetFolderAssignments}
                disabled={resettingFolders}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resettingFolders ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                {resettingFolders ? "Resetting…" : "Reset"}
              </button>
            </div>
            {resetFolderResult && (
              <div className={cn("mt-3 rounded-lg px-3 py-2 text-xs font-mono", resetFolderResult.startsWith("Error") ? "bg-red-950/40 border border-red-900/50 text-red-300" : "bg-emerald-950/40 border border-emerald-900/50 text-emerald-300")}>
                {resetFolderResult}
              </div>
            )}
          </CardRow>
          {/* Backup database */}
          <CardRow>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Backup database</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Export inventory, folders and assignments as a JSON file.
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const json = await tauriExportDatabase();
                    const blob = new Blob([json], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "vrc-studio-backup.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) { alert(String(e)); }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
            </div>
          </CardRow>

          {/* Restore database */}
          <CardRow last>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Restore database</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Import a previously exported backup. This will replace current data.
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const file = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
                    if (typeof file === "string") {
                      const { readTextFile } = await import("@tauri-apps/plugin-fs");
                      const content = await readTextFile(file);
                      await tauriImportDatabase(content);
                      useInventoryStore.getState().fetchAll();
                      alert("Database imported successfully. Inventory refreshed.");
                    }
                  } catch (e) { alert(String(e)); }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-xs text-white font-medium transition-colors shrink-0 border border-zinc-600"
              >
                <Upload className="h-3.5 w-3.5" /> Import
              </button>
            </div>
          </CardRow>

          {/* ── Fake inventory items (debug only) ── */}
          <CardRow>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100 flex items-center gap-1.5">
                  Generate fake items
                  <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-semibold tracking-wider">DEBUG ONLY</span>
                </p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Injects random inventory entries into the store — no real files are created.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={fakeCount}
                  onChange={(e) => setFakeCount(Math.max(1, Math.min(500, Number(e.target.value))))}
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 text-center focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={generateFakeItems}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-700/60 hover:bg-amber-600/70 text-xs text-amber-200 font-medium transition-colors border border-amber-600/40"
                >
                  <Plus className="h-3.5 w-3.5" /> Generate
                </button>
              </div>
            </div>
            {fakeGenerated && (
              <p className="mt-2 text-[10px] text-amber-400/80">
                ⚠ Fake items are active — they will disappear on restart.
              </p>
            )}
          </CardRow>

          <CardRow last>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-100">Clear fake items</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Removes all debug-generated items from the current session.
                </p>
              </div>
              <button
                onClick={clearFakeItems}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-red-900/50 hover:border-red-800/50 hover:text-red-300 text-xs text-zinc-300 font-medium transition-colors shrink-0 border border-zinc-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          </CardRow>
        </SettingsCard>
      </div>
    </>
  );
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

type SettingsTab = "general" | "packages" | "connections" |
  "storage-compression" | "updates" | "debug" | "appearance" | "logs";

interface NavGroup {
  groupKey: "settings_group_app" | "settings_group_connect" | "settings_group_system";
  items: { id: SettingsTab; labelKey: string; icon: React.ElementType }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: "settings_group_app",
    items: [
      { id: "general", labelKey: "settings_tab_general", icon: SettingsIcon },
      { id: "appearance", labelKey: "settings_tab_appearance", icon: Palette },
      { id: "storage-compression", labelKey: "settings_tab_storage_compression", icon: Archive },
    ],
  },
  {
    groupKey: "settings_group_connect",
    items: [
      { id: "packages", labelKey: "settings_tab_packages", icon: Package },
      { id: "connections", labelKey: "settings_tab_connections", icon: Wifi },
    ],
  },
  {
    groupKey: "settings_group_system",
    items: [
      { id: "updates", labelKey: "settings_tab_updates", icon: RefreshCw },
      { id: "logs", labelKey: "settings_tab_logs", icon: FileText },
      { id: "debug", labelKey: "settings_tab_debug", icon: Bug },
    ],
  },
];

// ── Settings page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div data-testid="page-settings" className="flex flex-1 min-h-0 h-full bg-zinc-950">
      <aside className="w-48 shrink-0 border-r border-zinc-800/60 flex flex-col bg-zinc-950 pt-3 pb-6 gap-0.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupKey}>
            <SidebarGroup label={t(group.groupKey)} />
            {group.items.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "relative w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg mx-1.5 text-sm font-medium transition-all text-left group",
                    active
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                  )}
                  style={active ? { color: "var(--accent-color)" } : {}}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-6 w-6 rounded-md transition-all shrink-0",
                      active ? "text-zinc-200" : "text-zinc-600 group-hover:text-zinc-400"
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 truncate">{t(item.labelKey as any)}</span>
                  {item.id === "appearance" && (
                    <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded shrink-0"
                      style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24" }}>
                      <FlaskConical className="h-2 w-2" />β
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto px-8 py-8 max-w-3xl">
        {activeTab === "general" && <GeneralSection />}
        {activeTab === "appearance" && <AppearanceSection />}
        {activeTab === "packages" && <PackagesSection />}
        {activeTab === "connections" && <ConnectionHub />}
        {activeTab === "storage-compression" && <StorageCompressionSection />}
        {activeTab === "updates" && <UpdatesSection />}
        {activeTab === "logs" && <LogsSection />}
        {activeTab === "debug" && <DebugSection />}
      </main>
    </div>
  );
}
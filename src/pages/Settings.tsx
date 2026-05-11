/**
 * Settings page — redesigned tabbed layout.
 * Tabs: General · Packages · Integrations · Compression · Updates · Debug
 */

import React, { useState, useCallback } from "react";
import {
  Globe, Tags, Save, Check, Beaker,
  RefreshCw, Package, Plus, Link, Upload,
  Loader2, AlertTriangle, CheckCircle2,
  Trash2, ExternalLink, ChevronRight,
  Settings as SettingsIcon, Plug, Bug,
  Archive, Download, Shield, Wifi, Palette,
  Lock, ShieldAlert, HardDrive, FolderOpen
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CompressionSection } from "@/components/settings/CompressionSection";
import { tauriPing, tauriFetchVpmIndex, VpmPackage } from "@/lib/tauri";
import { useRipperStatus, RipperStatus } from "@/hooks/useRipperStatus";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import { useT, useLocale, setLocale, Locale } from "@/i18n";
import { useTagStore, BehaviorSlot } from "@/store/tagStore";
import { useAppStore } from "@/store/app";
import { UpdateSettingsPanel } from "@/components/settings/UpdateSettingsPanel";
import { invoke } from "@tauri-apps/api/core";
import { useInventoryStore } from "@/store/inventoryStore";
import { DeveloperCodeModal } from "@/components/settings/DeveloperCodeModal";
import { isUntrustedSourcesUnlocked } from "@/hooks/useUntrustedSources";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { StorageSection } from "@/components/settings/StorageSection";

// ── helpers ───────────────────────────────────────────────────────────────────

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
    blue:   "bg-blue-600 border-blue-500/60",
    amber:  "bg-amber-600 border-amber-500/60",
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
    <p className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-600 select-none">
      {label}
    </p>
  );
}

/** Header de sección en el content */
function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4 pb-6 border-b border-zinc-800/60 mb-6">
      <div className="flex-shrink-0 p-2.5 rounded-xl bg-zinc-800 border border-zinc-700/50">
        <Icon className="h-5 w-5 text-zinc-300" />
      </div>
      <div>
        <h1 className="text-base font-semibold text-zinc-100">{title}</h1>
        <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
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
    try { localStorage.setItem("vpm_sources", JSON.stringify(next)); } catch {}
  };

  return {
    sources,
    addSource:    (src: VpmSource) => save([...sources, src]),
    addSources:   (s: VpmSource[]) => save([...sources, ...s]),
    removeSource: (id: string)     => save(sources.filter((s) => s.id !== id)),
  };
}

// ── Add by URL modal ──────────────────────────────────────────────────────────

function AddUrlModal({ onClose, onAdd }: { onClose: () => void; onAdd: (s: VpmSource) => void }) {
  const t = useT();
  const [url, setUrl]       = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<VpmPackage[] | null>(null);
  const [repoName, setRepoName] = useState("");
  const [error, setError]   = useState<string | null>(null);

  const handlePreview = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(null); setPreview(null);
    try {
      const pkgs = await tauriFetchVpmIndex(url.trim());
      setPreview(pkgs);
      try { setRepoName(new URL(url.trim()).hostname.replace(/^www\./, "")); } catch {}
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
  const [error, setError]     = useState<string | null>(null);
  const [parsed, setParsed]   = useState(false);

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
                <div className="flex items-center gap-2"><ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" /><span>VCC: <span className="font-mono text-zinc-400">%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json</span></span></div>
                <div className="flex items-center gap-2"><ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" /><span>alcom: <span className="font-mono text-zinc-400">%LOCALAPPDATA%\AlcomByVRCGet\settings.json</span></span></div>
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
              <button
                onClick={handleBrowse} disabled={loading}
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
                      {src.selected && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
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
  const [addUrlOpen,    setAddUrlOpen]    = useState(false);
  const [importVccOpen, setImportVccOpen] = useState(false);
  const [checkingId,    setCheckingId]    = useState<string | null>(null);
  const [checkResults,  setCheckResults]  = useState<Record<string, { count: number } | { error: string }>>({});

  const checkSource = async (src: VpmSource) => {
    setCheckingId(src.id);
    try {
      const pkgs = await tauriFetchVpmIndex(src.url);
      setCheckResults((prev) => ({ ...prev, [src.id]: { count: pkgs.length } }));
    } catch (e) {
      setCheckResults((prev) => ({ ...prev, [src.id]: { error: String(e) } }));
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <>
      {addUrlOpen    && <AddUrlModal   onClose={() => setAddUrlOpen(false)}    onAdd={(s) => { addSources([s]); setAddUrlOpen(false); }} />}
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
            const result    = checkResults[src.id];
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
    { slot: "base",      labelKey: "settings_behavior_base",      descKey: "settings_behavior_base_desc",      color: "text-amber-400" },
    { slot: "outfit",    labelKey: "settings_behavior_outfit",    descKey: "settings_behavior_outfit_desc",    color: "text-pink-400"  },
    { slot: "accessory", labelKey: "settings_behavior_accessory", descKey: "settings_behavior_accessory_desc", color: "text-violet-400" },
  ];

  return (
    <>
      <SectionHeader icon={SettingsIcon} title="General" description={t("settings_general_desc")} />

      <div className="flex flex-col gap-6">
        {/* Language */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" /> {t("settings_language")}
          </p>
          <SettingsCard>
            <CardRow last>
              <p className="text-xs text-zinc-500 mb-3">{t("settings_language_desc")}</p>
              <div className="flex gap-2 flex-wrap">
                {LOCALE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value} onClick={() => setLocale(opt.value)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm transition-all",
                      locale === opt.value
                        ? "border-violet-500/60 bg-violet-600/15 text-violet-300 font-medium"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                    )}
                  >
                    <span className="text-base">{opt.flag}</span>
                    {opt.label}
                    {locale === opt.value && <Check className="h-3.5 w-3.5 text-violet-400" />}
                  </button>
                ))}
              </div>
            </CardRow>
          </SettingsCard>
        </div>

        {/* Behavior labels */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Tags className="h-3.5 w-3.5" /> {t("settings_behavior_labels")}
          </p>
          <SettingsCard>
            <CardRow>
              <p className="text-xs text-zinc-500 leading-relaxed">{t("settings_behavior_desc")}</p>
            </CardRow>
            {slots.map(({ slot, labelKey, descKey, color }, idx) => (
              <CardRow key={slot} last={idx === slots.length - 1}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-medium", color)}>{t(labelKey)}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">{t(descKey)}</p>
                  </div>
                  <input
                    className="w-36 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500 font-mono transition-colors shrink-0"
                    value={draft[slot]}
                    onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                    spellCheck={false}
                  />
                </div>
              </CardRow>
            ))}
          </SettingsCard>
          <button
            onClick={handleSave}
            className={cn(
              "self-start flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border",
              saved
                ? "bg-emerald-700/20 border-emerald-500/40 text-emerald-300"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
            )}
          >
            {saved ? <><Check className="h-3.5 w-3.5" /> {t("settings_saved")}</> : <><Save className="h-3.5 w-3.5" /> {t("settings_behavior_save")}</>}
          </button>
        </div>
      </div>
    </>
  );
}

// ── BoothBlock ────────────────────────────────────────────────────────────────

function BoothBlock() {
  const t = useT();
  const { status, purchaseCount, loadingPurchases, connect, disconnect, refreshPurchases } = useBoothStatus();
  const statusColor = status === "connected" ? "text-emerald-400" : status === "unknown" ? "text-zinc-400" : "text-zinc-500";
  const statusText  = status === "connected"
    ? purchaseCount !== null
      ? `${t("ripper_connected")} — ${purchaseCount} purchased item${purchaseCount !== 1 ? "s" : ""} detected`
      : t("ripper_connected")
    : status === "unknown" ? t("ripper_checking") : t("ripper_disconnected");

  return (
    <SettingsCard>
      <CardRow last>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-100">Booth.pm</p>
            <p className={cn("text-xs mt-0.5", statusColor)}>{statusText}</p>
          </div>
          <div className="flex gap-2 items-center">
            {status === "connected" && (
              <>
                <button onClick={refreshPurchases} disabled={loadingPurchases} className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40">
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingPurchases && "animate-spin")} />
                </button>
                <button onClick={disconnect} className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-900/50 transition-colors">{t("ripper_disconnect")}</button>
              </>
            )}
            {(status === "disconnected" || status === "unknown") && (
              <button onClick={connect} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors">{t("ripper_connect")}</button>
            )}
          </div>
        </div>
        {status === "disconnected" && <p className="text-xs text-zinc-500 mt-2">{t("booth_connect_msg")}</p>}
      </CardRow>
    </SettingsCard>
  );
}

// ── RipperBlock ───────────────────────────────────────────────────────────────

function RipperBlock() {
  const t = useT();
  const { status, connect, disconnect, reconnect } = useRipperStatus();
  const statusColor: Record<RipperStatus, string> = {
    unknown: "text-zinc-400", connected: "text-emerald-400", disconnected: "text-zinc-500", expired: "text-amber-400",
  };
  const statusLabel: Record<RipperStatus, string> = {
    unknown: t("ripper_checking"), connected: t("ripper_connected"), disconnected: t("ripper_disconnected"), expired: t("ripper_expired"),
  };
  return (
    <SettingsCard>
      <CardRow last>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-100">Ripper.store</p>
            <p className={cn("text-xs mt-0.5", statusColor[status])}>{statusLabel[status]}</p>
          </div>
          <div className="flex gap-2">
            {status === "connected"   && <button onClick={disconnect} className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-900/50 transition-colors">{t("ripper_disconnect")}</button>}
            {(status === "disconnected" || status === "unknown") && <button onClick={connect} className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors">{t("ripper_connect")}</button>}
            {status === "expired"     && <button onClick={reconnect} className="px-3 py-1.5 text-xs rounded-lg bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 text-amber-300 transition-colors">{t("ripper_reconnect")}</button>}
          </div>
        </div>
        {status === "expired"      && <p className="text-xs text-amber-400/80 mt-2">{t("ripper_expired_msg")}</p>}
        {status === "disconnected" && <p className="text-xs text-zinc-500 mt-2">{t("ripper_connect_msg")}</p>}
      </CardRow>
    </SettingsCard>
  );
}

// ── ConnectionsSection ────────────────────────────────────────────────────────

function ConnectionsSection() {
  const t = useT();
  const { untrustedSourcesUnlocked, setUntrustedSourcesUnlocked } = useAppStore();
  const { riperstoreExperimental, setRiperstoreExperimental } = useAppStore();
  const [showCodeModal, setShowCodeModal] = useState(false);

  const handleUntrustedClick = () => {
    if (!untrustedSourcesUnlocked) {
      setShowCodeModal(true);
    }
  };

  const handleUnlocked = () => {
    setUntrustedSourcesUnlocked(true);
  };

  const handleLock = () => {
    setUntrustedSourcesUnlocked(false);
  };

  return (
    <>
      {showCodeModal && (
        <DeveloperCodeModal
          onClose={() => setShowCodeModal(false)}
          onUnlocked={handleUnlocked}
        />
      )}

      <SectionHeader
        icon={Wifi}
        title="Connections"
        description="Manage authentication with external platforms and integrations."
      />

      <div className="flex flex-col gap-6">
        {/* Booth */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Booth.pm</p>
          <BoothBlock />
        </div>

        {/* Untrusted Sources */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              Untrusted Sources
              {untrustedSourcesUnlocked && (
                <span className="text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-semibold">
                  UNLOCKED
                </span>
              )}
            </p>
            {untrustedSourcesUnlocked && (
              <button
                onClick={handleLock}
                className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors flex items-center gap-1"
              >
                <Lock className="h-3 w-3" /> Lock
              </button>
            )}
          </div>

          {!untrustedSourcesUnlocked ? (
            <SettingsCard>
              <CardRow last>
                <button
                  onClick={handleUntrustedClick}
                  className="w-full flex items-center gap-4 text-left group"
                >
                  <div className="p-2 rounded-xl bg-zinc-800 border border-zinc-700/50 group-hover:border-zinc-600 transition-colors">
                    <Lock className="h-4 w-4 text-zinc-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-300 group-hover:text-zinc-100 transition-colors">
                      Access Developer Integrations
                    </p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">
                      Requires a developer code to unlock
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-700 group-hover:text-zinc-500 transition-colors" />
                </button>
              </CardRow>
            </SettingsCard>
          ) : (
            <div className="flex flex-col gap-3">
              <SettingsCard>
                <CardRow last={!riperstoreExperimental}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-100">
                        {t("settings_riperstore_enable_label")}
                      </p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">
                        {t("settings_riperstore_enable_desc")}
                      </p>
                    </div>
                    <Toggle value={riperstoreExperimental} onChange={setRiperstoreExperimental} accent="blue" />
                  </div>
                </CardRow>
              </SettingsCard>
              {riperstoreExperimental && <RipperBlock />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── IntegrationsSection (legacy, not used in current navigation) ──────────────
function IntegrationsSection() {
  const t = useT();
  const { riperstoreExperimental, setRiperstoreExperimental } = useAppStore();

  return (
    <>
      <SectionHeader icon={Plug} title={t("settings_integrations_title")} description={t("settings_integrations_desc")} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Booth.pm</p>
          <BoothBlock />
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Beaker className="h-3.5 w-3.5 text-blue-400" />
            Riperstore
            <span className="text-[9px] bg-blue-600/20 border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded font-semibold tracking-wider">EXPERIMENTAL</span>
          </p>
          <SettingsCard>
            <CardRow last={!riperstoreExperimental}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{t("settings_riperstore_enable_label")}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{t("settings_riperstore_enable_desc")}</p>
                </div>
                <Toggle value={riperstoreExperimental} onChange={setRiperstoreExperimental} accent="blue" />
              </div>
            </CardRow>
          </SettingsCard>
          {riperstoreExperimental && <RipperBlock />}
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
  const { fetchAll: fetchInventory } = useInventoryStore();
  const [pingResponse, setPingResponse] = useState<string | null>(null);
  const [pingError,    setPingError]    = useState<string | null>(null);

  // reimport state
  const [reimportState, setReimportState] = useState<"idle" | "running" | "done">("idle");
  const [reimportResults, setReimportResults] = useState<ReimportResult[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);

  // reset folder assignments state
  const [resettingFolders, setResettingFolders] = useState(false);
  const [resetFolderResult, setResetFolderResult] = useState<string | null>(null);

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

  const ok      = reimportResults.filter((r) => r.status === "ok").length;
  const skipped = reimportResults.filter((r) => r.status === "skipped").length;
  const errors  = reimportResults.filter((r) => r.status === "error").length;

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
                          r.status === "ok"      && "text-emerald-400",
                          r.status === "skipped" && "text-zinc-500",
                          r.status === "error"   && "text-red-400",
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
        </SettingsCard>
      </div>
    </>
  );
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

type SettingsTab = "general" | "packages" | "integrations" | "connections" | "compression" | "updates" | "debug" | "appearance" | "storage";

interface NavGroup {
  groupKey: "settings_group_app" | "settings_group_connect" | "settings_group_system";
  items: { id: SettingsTab; labelKey: string; icon: React.ElementType }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupKey: "settings_group_app",
    items: [
      { id: "general",    labelKey: "settings_tab_general",    icon: SettingsIcon },
      { id: "appearance", labelKey: "settings_tab_appearance", icon: Palette },
      { id: "compression",labelKey: "settings_tab_compression",icon: Archive },
      { id: "storage",    labelKey: "settings_tab_storage",    icon: HardDrive },
    ],
  },
  {
    groupKey: "settings_group_connect",
    items: [
      { id: "packages",    labelKey: "settings_tab_packages",   icon: Package },
      { id: "connections", labelKey: "settings_tab_connections",icon: Wifi },
    ],
  },
  {
    groupKey: "settings_group_system",
    items: [
      { id: "updates", labelKey: "settings_tab_updates", icon: RefreshCw },
      { id: "debug",   labelKey: "settings_tab_debug",   icon: Bug },
    ],
  },
];

// ── Settings page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div data-testid="page-settings" className="flex flex-1 min-h-0 h-full bg-zinc-950">
      <aside className="w-52 shrink-0 border-r border-zinc-800/80 flex flex-col bg-zinc-950 pt-2 pb-6">
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
                    "relative w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-all text-left group",
                    active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {active && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-violet-500" />}
                  <span className={cn(
                    "flex items-center justify-center h-7 w-7 rounded-lg transition-all shrink-0",
                    active ? "bg-zinc-800 text-zinc-200" : "text-zinc-600 group-hover:text-zinc-400"
                  )}>
                    <item.icon className="h-3.5 w-3.5" />
                  </span>
                  {t(item.labelKey as any)}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto px-10 py-8 max-w-2xl">
        {activeTab === "general"      && <GeneralSection />}
        {activeTab === "appearance"   && <AppearanceSection />}
        {activeTab === "packages"     && <PackagesSection />}
        {activeTab === "connections"  && <ConnectionsSection />}
        {activeTab === "compression"  && <CompressionSectionWrapper />}
        {activeTab === "storage"      && <StorageSection />}
        {activeTab === "updates"      && <UpdatesSection />}
        {activeTab === "debug"        && <DebugSection />}
      </main>
    </div>
  );
}
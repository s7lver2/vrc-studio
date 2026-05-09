/**
 * Settings page — tabbed layout.
 * Tabs: General · Packages · Integrations · Appearance · Debug
 */

import React, { useState, useCallback } from "react";
import {
  Globe, Tags, Save, Check, Zap, Beaker,
  RefreshCw, Package, Plus, Link, Upload,
  Loader2, AlertTriangle, CheckCircle2,
  Trash2, ExternalLink, ChevronRight,
  Settings as SettingsIcon, Plug, Bug, Layers,
  Archive,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CompressionSection } from "@/components/settings/CompressionSection";
import { tauriPing, tauriFetchVpmIndex, VpmPackage } from "@/lib/tauri";
import { useRipperStatus, RipperStatus } from "@/hooks/useRipperStatus";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import { useT, useLocale, setLocale, Locale } from "@/i18n";
import { useTagStore, BehaviorSlot } from "@/store/tagStore";
import { useAppStore } from "@/store/app";
import { invoke } from "@tauri-apps/api/core";

// ── helpers ───────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ── VPM Source store (frontend-only for now) ──────────────────────────────────

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

// Simple in-memory store with localStorage persistence
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

  const addSource = (src: VpmSource) => save([...sources, src]);
  const addSources = (newSources: VpmSource[]) => save([...sources, ...newSources]);
  const removeSource = (id: string) => save(sources.filter((s) => s.id !== id));
  const updateCount = (id: string, count: number) =>
    save(sources.map((s) => (s.id === id ? { ...s, packageCount: count } : s)));

  return { sources, addSource, addSources, removeSource, updateCount };
}

// ── Add by URL modal ──────────────────────────────────────────────────────────

function AddUrlModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (src: VpmSource) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<VpmPackage[] | null>(null);
  const [repoName, setRepoName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const pkgs = await tauriFetchVpmIndex(url.trim());
      setPreview(pkgs);
      // Try to infer a name from URL
      try {
        const hostname = new URL(url.trim()).hostname.replace(/^www\./, "");
        setRepoName(hostname);
      } catch {}
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    if (!preview) return;
    onAdd({
      id: crypto.randomUUID(),
      name: repoName || url,
      url: url.trim(),
      packageCount: preview.length,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Add VPM source from URL</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Paste a VPM repository URL to preview its packages</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col gap-4 px-5 py-4 overflow-y-auto">
          {/* URL input */}
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); setError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handlePreview(); }}
              placeholder="https://example.com/index.json"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 px-3 py-2 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
              autoFocus
            />
            <button
              onClick={handlePreview}
              disabled={!url.trim() || loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm text-zinc-200 transition-colors disabled:opacity-40 shrink-0"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Preview
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-900/40 px-3 py-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="flex flex-col gap-3">
              {/* Name input */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1 block">Source name</label>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="e.g. My Custom Repo"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 px-3 py-1.5 focus:outline-none focus:border-zinc-500 placeholder-zinc-600"
                />
              </div>

              {/* Package list */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Packages found ({preview.length})
                  </p>
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> Valid repository
                  </span>
                </div>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
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
                  {preview.length > 50 && (
                    <p className="text-center text-[10px] text-zinc-600 py-1">+{preview.length - 50} more…</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!preview || !url.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm font-medium text-white transition-colors disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add source
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Import from alcom/VCC modal ───────────────────────────────────────────────

interface ImportedVccSource {
  name: string;
  url: string;
  selected: boolean;
}

function ImportVccModal({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (sources: ImportedVccSource[]) => void;
}) {
  const [sources, setSources] = useState<ImportedVccSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState(false);

  const handleBrowse = async () => {
    const result = await openDialog({
      title: "Select VCC / alcom settings file",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!result || typeof result !== "string") return;

    setLoading(true);
    setError(null);
    try {
      // Usar el comando Tauri personalizado
      const content = await invoke<string>("read_file_as_string", { path: result });
      const json = JSON.parse(content);

      const userRepos: any[] = json.userRepos ?? json.UserRepos ?? json.repos ?? [];
      const discovered: ImportedVccSource[] = userRepos
        .map((r: any) => ({
          name: r.name ?? r.Name ?? r.localPath ?? r.url ?? "Unknown",
          url: r.url ?? r.URL ?? r.localPath ?? "",
          selected: true,
        }))
        .filter((r) => r.url);

      if (discovered.length === 0) {
        setError("No VPM sources found in this file. Make sure it's a valid VCC / alcom settings.json.");
      } else {
        setSources(discovered);
        setParsed(true);
      }
    } catch (e) {
      setError(`Could not parse file: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    onImport(sources.filter((s) => s.selected));
    onClose();
  };

  const toggle = (i: number) =>
    setSources((prev) => prev.map((s, j) => (j === i ? { ...s, selected: !s.selected } : s)));

  const selectedCount = sources.filter((s) => s.selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col max-h-[75vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Import from alcom / VCC</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Import your existing VPM sources from Creator Companion</p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {!parsed ? (
            <>
              <div className="flex flex-col gap-1.5 text-xs text-zinc-500">
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span>VCC: <span className="font-mono text-zinc-400">%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json</span></span>
                </div>
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-3 w-3 text-zinc-600 shrink-0" />
                  <span>alcom: <span className="font-mono text-zinc-400">%LOCALAPPDATA%\AlcomByVRCGet\settings.json</span></span>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-950/30 border border-red-900/40 px-3 py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-px" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}

              <button
                onClick={handleBrowse}
                disabled={loading}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 px-4 py-3 text-sm text-zinc-200 transition-colors disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Browse for settings.json
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-zinc-400">
                Found <span className="text-zinc-200 font-medium">{sources.length}</span> source{sources.length !== 1 ? "s" : ""}. Select which ones to import:
              </p>
              <div className="flex flex-col gap-1.5">
                {sources.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => toggle(i)}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      src.selected
                        ? "border-red-600/50 bg-red-950/20"
                        : "border-zinc-700/50 bg-zinc-800/30"
                    }`}
                  >
                    <div className={`mt-0.5 h-4 w-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                      src.selected ? "bg-red-600 border-red-600" : "border-zinc-600 bg-zinc-800"
                    }`}>
                      {src.selected && (
                        <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
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

        {/* Footer */}
        {parsed && (
          <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-sm font-medium text-white transition-colors disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" /> Import {selectedCount} source{selectedCount !== 1 ? "s" : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Packages tab ──────────────────────────────────────────────────────────────

function PackagesSection() {
  const { sources, addSources, removeSource } = useVpmSources(); // ← usa addSources
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [importVccOpen, setImportVccOpen] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, { count: number } | { error: string }>>({});

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

  const handleImportVcc = (imported: ImportedVccSource[]) => {
    const newSources = imported.map(s => ({
      id: crypto.randomUUID(),
      name: s.name,
      url: s.url,
    }));
    addSources(newSources); // ✅ importación múltiple
  };

  return (
    <>
      {addUrlOpen && (
        <AddUrlModal
          onClose={() => setAddUrlOpen(false)}
          onAdd={(src) => { addSources([src]); setAddUrlOpen(false); }}
        />
      )}
      {importVccOpen && (
        <ImportVccModal
          onClose={() => setImportVccOpen(false)}
          onImport={handleImportVcc}
        />
      )}

      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Packages</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Manage VPM (VRChat Package Manager) repositories used when installing packages into projects.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">VPM Sources ({sources.length})</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setImportVccOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                <Upload className="h-3 w-3" /> Import from alcom / VCC
              </button>
              <button
                onClick={() => setAddUrlOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-700 hover:bg-zinc-600 text-xs text-zinc-100 transition-colors"
              >
                <Plus className="h-3 w-3" /> Add from URL
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {sources.map((src) => {
              const result = checkResults[src.id];
              const isChecking = checkingId === src.id;
              return (
                <div
                  key={src.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
                >
                  <div className={cn(
                    "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                    src.isOfficial ? "bg-red-950/60 border border-red-900/40" : "bg-zinc-800 border border-zinc-700"
                  )}>
                    <Package className={cn("h-4 w-4", src.isOfficial ? "text-red-400" : "text-zinc-500")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-200 truncate">{src.name}</p>
                      {src.isOfficial && (
                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider bg-red-950/60 border border-red-900/40 text-red-400 px-1.5 py-0.5 rounded">
                          Official
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">{src.url}</p>
                    {result && (
                      <p className={`text-[10px] mt-0.5 ${
                        "error" in result ? "text-red-400" : "text-emerald-400"
                      }`}>
                        {"error" in result ? `✗ ${result.error}` : `✓ ${result.count} packages available`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => checkSource(src)}
                      disabled={isChecking}
                      title="Test connection"
                      className="h-7 w-7 flex items-center justify-center rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40"
                    >
                      {isChecking
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                    </button>
                    {!src.isOfficial && (
                      <button
                        onClick={() => removeSource(src.id)}
                        title="Remove source"
                        className="h-7 w-7 flex items-center justify-center rounded-md border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-900/60 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-zinc-600 leading-relaxed">
            These repositories are used when browsing and installing packages in the{" "}
            <span className="text-zinc-400">Packages</span> tab of each project.
            You can add community repositories or your own private ones.
          </p>
        </div>
      </div>
    </>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────

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

  const slots: { slot: BehaviorSlot; label: string; color: string; desc: string }[] = [
    { slot: "base",      label: t("settings_behavior_base"),      color: "text-amber-400", desc: t("settings_behavior_base_desc") },
    { slot: "outfit",    label: t("settings_behavior_outfit"),    color: "text-pink-400",  desc: t("settings_behavior_outfit_desc") },
    { slot: "accessory", label: t("settings_behavior_accessory"), color: "text-purple-400",desc: t("settings_behavior_accessory_desc") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">General</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Language and labeling preferences.</p>
      </div>

      {/* Language */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" /> {t("settings_language")}
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
          <p className="text-xs text-zinc-500">{t("settings_language_desc")}</p>
          <div className="flex gap-2">
            {LOCALE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setLocale(opt.value)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm transition-all ${
                  locale === opt.value
                    ? "border-red-500/60 bg-red-600/15 text-red-300 font-medium"
                    : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                }`}
              >
                <span className="text-base">{opt.flag}</span>
                {opt.label}
                {locale === opt.value && <Check className="h-3.5 w-3.5 text-red-400 ml-1" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Behavior labels */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
          <Tags className="h-3.5 w-3.5" /> {t("settings_behavior_labels")}
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-4">
          <p className="text-xs text-zinc-500 leading-relaxed">{t("settings_behavior_desc")}</p>
          <div className="flex flex-col gap-3">
            {slots.map(({ slot, label, color, desc }) => (
              <div key={slot} className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${color}`}>{label}</label>
                <p className="text-[10px] text-zinc-600">{desc}</p>
                <input
                  className="w-full max-w-xs bg-zinc-800 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500 font-mono transition-colors"
                  value={draft[slot]}
                  onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  spellCheck={false}
                />
              </div>
            ))}
          </div>
          <button
            onClick={handleSave}
            className={`self-start flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              saved
                ? "bg-green-700/30 border border-green-500/40 text-green-300"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100 border border-zinc-600"
            }`}
          >
            {saved ? <><Check className="h-3.5 w-3.5" /> Saved!</> : <><Save className="h-3.5 w-3.5" /> {t("settings_behavior_save")}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Integrations tab ──────────────────────────────────────────────────────────

function RipperBlock() {
  const t = useT();
  const { status, connect, disconnect, reconnect } = useRipperStatus();
  const statusColor: Record<RipperStatus, string> = {
    unknown: "text-zinc-400", connected: "text-green-400",
    disconnected: "text-zinc-500", expired: "text-yellow-400",
  };
  const statusLabel: Record<RipperStatus, string> = {
    unknown: t("ripper_checking"), connected: t("ripper_connected"),
    disconnected: t("ripper_disconnected"), expired: t("ripper_expired"),
  };
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-100">Ripper.store</p>
          <p className={`text-xs mt-0.5 ${statusColor[status]}`}>{statusLabel[status]}</p>
        </div>
        <div className="flex gap-2">
          {status === "connected" && (
            <button onClick={disconnect} className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50 transition-colors">{t("ripper_disconnect")}</button>
          )}
          {(status === "disconnected" || status === "unknown") && (
            <button onClick={connect} className="px-3 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors">{t("ripper_connect")}</button>
          )}
          {status === "expired" && (
            <button onClick={reconnect} className="px-3 py-1.5 text-xs rounded-md bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/40 text-yellow-300 transition-colors">{t("ripper_reconnect")}</button>
          )}
        </div>
      </div>
      {status === "expired" && <p className="text-xs text-yellow-400/80">{t("ripper_expired_msg")}</p>}
      {status === "disconnected" && <p className="text-xs text-zinc-500">{t("ripper_connect_msg")}</p>}
    </div>
  );
}

function BoothBlock() {
  const t = useT();
  const { status, purchaseCount, loadingPurchases, connect, disconnect, refreshPurchases } = useBoothStatus();
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-100">Booth.pm</p>
          <p className={`text-xs mt-0.5 ${status === "connected" ? "text-green-400" : status === "unknown" ? "text-zinc-400" : "text-zinc-500"}`}>
            {status === "connected"
              ? purchaseCount !== null ? `${t("ripper_connected")} — ${purchaseCount} purchased item${purchaseCount !== 1 ? "s" : ""} detected` : t("ripper_connected")
              : status === "unknown" ? t("ripper_checking") : t("ripper_disconnected")}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {status === "connected" && (
            <>
              <button onClick={refreshPurchases} disabled={loadingPurchases} className="p-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors disabled:opacity-40">
                <RefreshCw className={`h-3.5 w-3.5 ${loadingPurchases ? "animate-spin" : ""}`} />
              </button>
              <button onClick={disconnect} className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50 transition-colors">{t("ripper_disconnect")}</button>
            </>
          )}
          {(status === "disconnected" || status === "unknown") && (
            <button onClick={connect} className="px-3 py-1.5 text-xs rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors">{t("ripper_connect")}</button>
          )}
        </div>
      </div>
      {status === "disconnected" && <p className="text-xs text-zinc-500">{t("booth_connect_msg")}</p>}
    </div>
  );
}

function IntegrationsSection() {
  const t = useT();
  const { riperstoreExperimental, setRiperstoreExperimental } = useAppStore();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Integrations</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Connect to external services for inventory sync and downloads.</p>
      </div>

      {/* Booth */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("settings_integrations")}</h2>
        <BoothBlock />
      </div>

      {/* Riperstore — experimental */}
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
          <Beaker className="h-3.5 w-3.5 text-blue-400" />
          Riperstore
          <span className="text-[9px] bg-blue-600/20 border border-blue-500/30 text-blue-400 px-1.5 py-0.5 rounded font-semibold tracking-wider">EXPERIMENTAL</span>
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-100">Activar Riperstore</p>
            <p className="text-[10px] text-zinc-500 mt-px">
              Habilita la integración con Ripper.store. Función experimental — puede cambiar sin previo aviso.
            </p>
          </div>
          <button
            onClick={() => setRiperstoreExperimental(!riperstoreExperimental)}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full border transition-all duration-300 ${riperstoreExperimental ? "bg-blue-500/20 border-blue-500/60" : "bg-zinc-800 border-zinc-700"}`}
            style={riperstoreExperimental ? { boxShadow: "0 0 10px rgba(59,130,246,0.25)" } : {}}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-300 ${riperstoreExperimental ? "left-[calc(100%-22px)] bg-blue-400" : "left-0.5 bg-zinc-600"}`} />
          </button>
        </div>
        {riperstoreExperimental && <RipperBlock />}
      </div>
    </div>
  );
}

// ── Appearance tab ────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { awesomeAnimations, setAwesomeAnimations } = useAppStore();
  const enabled = awesomeAnimations > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Appearance</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Visual and animation preferences.</p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
          <Beaker className="h-3.5 w-3.5 text-red-400" />
          Experimental
          <span className="text-[9px] bg-red-600/20 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded font-semibold tracking-wider">BETA</span>
        </h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Zap className={`h-3.5 w-3.5 ${enabled ? "text-amber-400" : "text-zinc-500"}`} />
              <div>
                <p className="text-sm font-medium text-zinc-100 font-mono">awesome_animations</p>
                <p className="text-[10px] text-zinc-500 mt-px">
                  {enabled ? "Animaciones activadas — transiciones, brillos y efectos." : "Sin animaciones — interfaz instantánea."}
                </p>
              </div>
            </div>
            <button
              onClick={() => setAwesomeAnimations(enabled ? 0 : 2)}
              className={`relative flex-shrink-0 w-12 h-6 rounded-full border transition-all duration-300 ${enabled ? "bg-amber-500/20 border-amber-500/60" : "bg-zinc-800 border-zinc-700"}`}
              style={enabled ? { boxShadow: "0 0 12px rgba(245,158,11,0.25)" } : {}}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full shadow transition-all duration-300 ${enabled ? "left-[calc(100%-22px)] bg-amber-400" : "left-0.5 bg-zinc-600"}`} />
              {enabled && <Zap className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-amber-900 pointer-events-none" />}
            </button>
          </div>
          {enabled && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {["Page transitions", "Glow effects", "Button ripples"].map((label) => (
                <div key={label} className="flex flex-col items-center gap-1.5 p-2.5 rounded-md border border-amber-500/20 bg-amber-500/5" style={{ animation: "vrc-fadeInUp 0.4s ease-out backwards" }}>
                  <div className="w-6 h-6 rounded-full bg-amber-400/20 border border-amber-500/30" style={{ animation: "vrc-pulse 2s ease-in-out infinite" }} />
                  <p className="text-[9px] text-amber-400/70 text-center leading-tight">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Debug tab ─────────────────────────────────────────────────────────────────

function DebugSection() {
  const t = useT();
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePing = async () => {
    try {
      const res = await tauriPing("vrc-studio");
      setResponse(res);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Debug</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Diagnostic tools and IPC testing.</p>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{t("settings_debug")}</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
          <button
            onClick={handlePing}
            className="self-start px-4 py-2 bg-red-600 rounded-md text-sm text-white hover:bg-red-700 transition-colors"
          >
            {t("settings_test_ipc")}
          </button>
          {response && <p className="text-green-400 text-sm font-mono">✓ {response}</p>}
          {error && <p className="text-red-400 text-sm font-mono">✗ {error}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

type SettingsTab = "general" | "packages" | "integrations" | "appearance" | "compression" | "debug";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "general",      label: "General",      icon: SettingsIcon },
  { id: "packages",     label: "Packages",     icon: Package },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "appearance",   label: "Appearance",   icon: Layers },
  { id: "compression",  label: "Compression",  icon: Archive },
  { id: "debug",        label: "Debug",        icon: Bug },
];

// ── Settings page ─────────────────────────────────────────────────────────────

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div data-testid="page-settings" className="flex flex-1 min-h-0 h-full">
      {/* Sidebar */}
      <aside className="w-48 shrink-0 border-r border-zinc-800 flex flex-col py-6 px-3 gap-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left",
              activeTab === item.id
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-8 py-8 max-w-2xl">
          {activeTab === "general"      && <GeneralSection />}
          {activeTab === "packages"     && <PackagesSection />}
          {activeTab === "integrations" && <IntegrationsSection />}
          {activeTab === "appearance"   && <AppearanceSection />}
          {activeTab === "compression"  && <CompressionSection />}
          {activeTab === "debug"        && <DebugSection />}
      </main>
    </div>
  );
}
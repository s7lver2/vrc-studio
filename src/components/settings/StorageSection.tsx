/**
 * StorageSection — ajustes de almacenamiento:
 *  • Estadísticas de disco (assets, thumbnails, DB, huérfanos)
 *  • Botón "Limpiar caché" con breakdown del espacio que liberará
 *  • Configuración de la ruta raíz de assets + migración
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  HardDrive, FolderOpen, Trash2, RefreshCw,
  AlertTriangle, CheckCircle2, Loader2, ArrowRight,
  Database, Image, Package, FolderArchive, X,
  Sparkles, FileImage, Layers, Video,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { SpaceReclaimerModal } from "./SpaceReclaimerModal";
import { useT } from "@/i18n";

// ── helpers ────────────────────────────────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface StorageStats {
  assets_bytes: number;
  thumbnails_bytes: number;
  db_bytes: number;
  total_bytes: number;
  orphaned_bytes: number;
  orphaned_count: number;
  assets_root: string;
}

interface MigrationResult {
  moved: number;
  errors: string[];
  new_assets_root: string;
}

type ClearState = "idle" | "confirming" | "running" | "done";

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatBar({
  label,
  bytes,
  total,
  icon: Icon,
  color,
}: {
  label: string;
  bytes: number;
  total: number;
  icon: React.ElementType;
  color: string;
}) {
  const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-3.5 w-3.5", color)} />
          <span className="text-xs text-zinc-400">{label}</span>
        </div>
        <span className="text-xs font-mono text-zinc-300">{fmtBytes(bytes)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color.replace("text-", "bg-"))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Confirm dialog ─────────────────────────────────────────────────────────────

function ClearConfirmDialog({
  stats,
  onConfirm,
  onCancel,
}: {
  stats: StorageStats;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const freeable = stats.thumbnails_bytes + stats.orphaned_bytes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 shrink-0">
            <Trash2 className="h-4 w-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Clear cache?</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              This will permanently delete thumbnails and orphaned asset folders.
              It will free up approximately{" "}
              <span className="text-zinc-300 font-medium">{fmtBytes(freeable)}</span>.
            </p>
          </div>
        </div>

        {/* Breakdown */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800/60 text-xs">
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2 text-zinc-400">
              <Image className="h-3.5 w-3.5 text-sky-400" />
              Thumbnails
            </div>
            <span className="font-mono text-zinc-300">{fmtBytes(stats.thumbnails_bytes)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-2 text-zinc-400">
              <FolderArchive className="h-3.5 w-3.5 text-amber-400" />
              Orphaned assets ({stats.orphaned_count})
            </div>
            <span className="font-mono text-zinc-300">{fmtBytes(stats.orphaned_bytes)}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-2.5 font-semibold">
            <span className="text-zinc-300">Total freed</span>
            <span className="font-mono text-emerald-400">{fmtBytes(freeable)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium text-white transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear {fmtBytes(freeable)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Migration confirm dialog ───────────────────────────────────────────────────

function MigrateDialog({
  oldPath,
  newPath,
  onMigrate,
  onSkip,
  onCancel,
}: {
  oldPath: string;
  newPath: string;
  onMigrate: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20 shrink-0">
            <FolderOpen className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Migrate existing assets?</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              You changed the assets folder. Do you want to move your current items to the new location?
            </p>
          </div>
        </div>

        {/* Paths */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">From</p>
            <p className="text-xs font-mono text-zinc-400 break-all">{oldPath}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-zinc-800" />
            <ArrowRight className="h-3.5 w-3.5 text-violet-400 shrink-0" />
            <div className="flex-1 h-px bg-zinc-800" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">To</p>
            <p className="text-xs font-mono text-zinc-300 break-all">{newPath}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            onClick={onMigrate}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Move assets to new folder
          </button>
          <button
            onClick={onSkip}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Only update the path (keep files where they are)
          </button>
          <button
            onClick={onCancel}
            className="text-center text-xs text-zinc-600 hover:text-zinc-400 transition-colors py-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Migration progress ─────────────────────────────────────────────────────────

function MigrationProgress({
  result,
  onDone,
}: {
  result: MigrationResult | null;
  loading: boolean;
  onDone: () => void;
}) {
  if (!result) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500 py-3">
        <Loader2 className="h-4 w-4 animate-spin" />
        Moving files…
      </div>
    );
  }

  const hasErrors = result.errors.length > 0;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
      <div className={cn("flex items-center gap-2 text-sm font-medium", hasErrors ? "text-amber-300" : "text-emerald-300")}>
        {hasErrors
          ? <AlertTriangle className="h-4 w-4" />
          : <CheckCircle2 className="h-4 w-4" />}
        {result.moved} {result.moved === 1 ? "folder" : "folders"} moved
        {hasErrors && `, ${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}`}
      </div>
      {hasErrors && (
        <div className="rounded-lg border border-amber-900/30 bg-amber-950/20 divide-y divide-amber-900/20 max-h-32 overflow-y-auto">
          {result.errors.map((e, i) => (
            <p key={i} className="text-[10px] font-mono text-amber-400/80 px-3 py-1.5">{e}</p>
          ))}
        </div>
      )}
      <button
        onClick={onDone}
        className="self-end text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
      >
        <X className="h-3 w-3" /> Dismiss
      </button>
    </div>
  );
}

// ── Main section ───────────────────────────────────────────────────────────────

export function StorageSection() {
  const t = useT();

  // Stats
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Clear cache
  const [clearState, setClearState] = useState<ClearState>("idle");
  const [freedBytes, setFreedBytes] = useState<number | null>(null);

  // Asset path
  const [customPath, setCustomPath] = useState<string>("");
  const [pendingPath, setPendingPath] = useState<string | null>(null); // waiting for migrate decision
  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [showMigrationResult, setShowMigrationResult] = useState(false);
  const [showReclaimer, setShowReclaimer] = useState(false);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const s = await invoke<StorageStats>("get_storage_stats");
      setStats(s);
      setCustomPath(s.assets_root);
    } catch (e) {
      setStatsError(String(e));
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Load current settings path on mount ─────────────────────────────────────
  useEffect(() => {
    invoke<{ custom_assets_dir: string | null }>("get_app_settings").then((s) => {
      if (s.custom_assets_dir) setCustomPath(s.custom_assets_dir);
    }).catch(() => {});
  }, []);

  // ── Browse folder ────────────────────────────────────────────────────────────
  const handleBrowse = async () => {
    const selected = await openDialog({ directory: true, title: "Select assets folder" });
    if (!selected || typeof selected !== "string") return;
    const currentRoot = stats?.assets_root ?? "";
    const normalizeSlash = (p: string) => p.replace(/[/\\]+$/, "");
    if (normalizeSlash(selected) !== normalizeSlash(currentRoot)) {
      setPendingPath(selected);
    } else {
      setCustomPath(selected);
    }
  };

  // ── Migration ────────────────────────────────────────────────────────────────
  const handleMigrate = async (newPath: string, doMove: boolean) => {
    setPendingPath(null);
    setCustomPath(newPath);
    setMigrating(true);
    setShowMigrationResult(true);
    setMigrationResult(null);
    try {
      if (doMove) {
        const result = await invoke<MigrationResult>("migrate_assets", { newDir: newPath });
        setMigrationResult(result);
      } else {
        // Only update the setting, no move
        await invoke("set_app_settings", { settings: { custom_assets_dir: newPath } });
        setMigrationResult({ moved: 0, errors: [], new_assets_root: newPath });
      }
    } catch (e) {
      setMigrationResult({ moved: 0, errors: [String(e)], new_assets_root: newPath });
    } finally {
      setMigrating(false);
      await loadStats();
    }
  };

  // ── Clear cache ───────────────────────────────────────────────────────────────
  const handleClearConfirm = async () => {
    setClearState("running");
    try {
      const freed = await invoke<number>("clear_all_cache");
      setFreedBytes(freed);
      setClearState("done");
    } catch {
      setClearState("done");
      setFreedBytes(0);
    } finally {
      await loadStats();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Dialogs */}
      {clearState === "confirming" && stats && (
        <ClearConfirmDialog
          stats={stats}
          onConfirm={handleClearConfirm}
          onCancel={() => setClearState("idle")}
        />
      )}

      {pendingPath && stats && (
        <MigrateDialog
          oldPath={stats.assets_root}
          newPath={pendingPath}
          onMigrate={() => handleMigrate(pendingPath, true)}
          onSkip={() => handleMigrate(pendingPath, false)}
          onCancel={() => setPendingPath(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-start gap-4 pb-6 border-b border-zinc-800/60 mb-6">
        <div className="flex-shrink-0 p-2.5 rounded-xl bg-zinc-800 border border-zinc-700/50">
          <HardDrive className="h-5 w-5 text-zinc-300" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Storage</h1>
          <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
            Disk usage, cache cleanup, and asset folder location.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-7">

        {/* ── Disk usage ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" />
              Disk Usage
            </p>
            <button
              onClick={loadStats}
              disabled={statsLoading}
              className="h-7 w-7 flex items-center justify-center rounded-lg border border-zinc-700/60 text-zinc-600 hover:text-zinc-300 hover:border-zinc-500 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3 w-3", statsLoading && "animate-spin")} />
            </button>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            {statsError ? (
              <div className="flex items-center gap-2 px-5 py-4 text-xs text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {statsError}
              </div>
            ) : statsLoading && !stats ? (
              <div className="flex items-center gap-2 px-5 py-4 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Calculating…
              </div>
            ) : stats ? (
              <div className="px-5 py-4 flex flex-col gap-4">
                <StatBar
                  label="Assets"
                  bytes={stats.assets_bytes}
                  total={stats.total_bytes}
                  icon={Package}
                  color="text-violet-400"
                />
                <StatBar
                  label="Thumbnails"
                  bytes={stats.thumbnails_bytes}
                  total={stats.total_bytes}
                  icon={Image}
                  color="text-sky-400"
                />
                <StatBar
                  label="Database"
                  bytes={stats.db_bytes}
                  total={stats.total_bytes}
                  icon={Database}
                  color="text-emerald-400"
                />
                {stats.orphaned_bytes > 0 && (
                  <StatBar
                    label={`Orphaned files (${stats.orphaned_count})`}
                    bytes={stats.orphaned_bytes}
                    total={stats.total_bytes}
                    icon={FolderArchive}
                    color="text-amber-400"
                  />
                )}
                <div className="pt-1 border-t border-zinc-800/60 flex items-center justify-between">
                  <span className="text-xs text-zinc-500">Total</span>
                  <span className="text-sm font-semibold text-zinc-200 font-mono">
                    {fmtBytes(stats.total_bytes)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Clear cache ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            Cache
          </p>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-100">Clear cache</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Removes thumbnails and orphaned asset folders.{" "}
                    {stats && (
                      <span className="text-zinc-400">
                        Will free ~{fmtBytes(stats.thumbnails_bytes + stats.orphaned_bytes)}.
                      </span>
                    )}
                  </p>
                </div>

                {clearState === "done" ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
                    <CheckCircle2 className="h-4 w-4" />
                    Freed {fmtBytes(freedBytes ?? 0)}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      if (clearState === "running") return;
                      setFreedBytes(null);
                      setClearState("confirming");
                    }}
                    disabled={clearState === "running" || (!!stats && stats.thumbnails_bytes === 0 && stats.orphaned_bytes === 0)}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 border",
                      clearState === "running"
                        ? "bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed"
                        : "bg-red-600/20 hover:bg-red-600/30 border-red-800/50 text-red-300 hover:text-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                  >
                    {clearState === "running"
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Clearing…</>
                      : <><Trash2 className="h-3.5 w-3.5" /> Clear cache</>}
                  </button>
                )}
              </div>

              {clearState === "done" && (
                <button
                  onClick={() => { setClearState("idle"); setFreedBytes(null); }}
                  className="mt-2 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Free Up Space ──────────────────────────────────────────────────────── */}
        {showReclaimer && (
          <SpaceReclaimerModal onClose={() => { setShowReclaimer(false); loadStats(); }} />
        )}

        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Space Recovery
          </p>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-zinc-100">Free Up Space</p>
                  <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed max-w-xs">
                    Scan Unity projects and your asset library for heavy files you don't need —
                    PSD source art, Blender files, Unity caches, video references. You choose what to delete.
                  </p>
                  <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                    {[
                      { icon: FileImage, label: "PSD/AI",   color: "text-sky-400"     },
                      { icon: Layers,    label: "Blender",   color: "text-orange-400"  },
                      { icon: Package,   label: "Unity cache", color: "text-violet-400" },
                      { icon: Video,     label: "Videos",    color: "text-pink-400"    },
                    ].map(({ icon: Icon, label, color }) => (
                      <span key={label} className="flex items-center gap-1 text-[10px] text-zinc-600">
                        <Icon className={`h-3 w-3 ${color}`} /> {label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setShowReclaimer(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-800/50 text-violet-300 hover:text-violet-200 text-xs font-medium transition-colors shrink-0 whitespace-nowrap"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Free Up Space
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Assets folder ────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5" />
            Assets Folder
          </p>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-5 py-4 flex flex-col gap-3">
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Location where all downloaded and imported assets are stored. Changing this lets you
                move your library to a larger drive. You'll be offered to migrate your current items.
              </p>

              {/* Path display + browse */}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-300 truncate">
                  {customPath || (stats?.assets_root ?? "—")}
                </div>
                <button
                  onClick={handleBrowse}
                  disabled={migrating}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors shrink-0 disabled:opacity-40"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Browse…
                </button>
              </div>

              {/* Migration progress / result */}
              {showMigrationResult && (
                <MigrationProgress
                  result={migrationResult}
                  loading={migrating}
                  onDone={() => { setShowMigrationResult(false); setMigrationResult(null); }}
                />
              )}

              {/* Reset to default */}
              {customPath && stats && customPath !== stats.assets_root && !migrating && (
                <button
                  onClick={() => setPendingPath(
                    /* default cache dir — backend resolves if custom_assets_dir is null */
                    ""
                  )}
                  className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Reset to default location
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
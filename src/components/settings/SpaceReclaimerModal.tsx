// src/components/settings/SpaceReclaimerModal.tsx

/**
 * SpaceReclaimerModal — escanea proyectos e inventario buscando archivos
 * pesados/innecesarios y permite al usuario seleccionar qué eliminar.
 *
 * Flujo:
 *  1. Escanear → lista de ReclaimableFile ordenada por tamaño
 *  2. Usuario filtra por categoría / selecciona items
 *  3. "Delete selected" → confirmación → borrado → resultado
 */

import { useState, useCallback, useMemo } from "react";
import {
  X, Search, Trash2, RefreshCw, AlertTriangle,
  CheckSquare, Square, ChevronDown, ChevronUp,
  FolderOpen, FileImage, Layers, Video, FileText, Package,
  Loader2, CheckCircle2, Filter,
} from "lucide-react";
import {
  ReclaimableFile, ScanReclaimableOptions,
  tauriScanReclaimable, tauriDeleteReclaimable,
} from "@/lib/tauri";
import { invoke } from "@tauri-apps/api/core";

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  source_art:    { label: "Source Art (PSD/AI)",    icon: FileImage, color: "text-sky-400"     },
  blender:       { label: "Blender files",           icon: Layers,    color: "text-orange-400"  },
  unity_cache:   { label: "Unity Cache (Library/Temp)", icon: Package, color: "text-violet-400" },
  video:         { label: "Video files",             icon: Video,     color: "text-pink-400"    },
  log:           { label: "Log files",               icon: FileText,  color: "text-zinc-400"    },
};

interface Props {
  onClose: () => void;
  /** Rutas de búsqueda (proyectos + inventario). Si no se pasan, se obtienen del backend. */
  searchPaths?: string[];
}

export function SpaceReclaimerModal({ onClose, searchPaths }: Props) {
  const [phase, setPhase] = useState<"options" | "scanning" | "results" | "deleting" | "done">("options");
  const [options, setOptions] = useState<ScanReclaimableOptions>({
    min_size_bytes:      5 * 1024 * 1024,  // 5 MB
    include_unity_cache: true,
    include_source_art:  true,
    include_blender:     true,
    include_logs:        false,
    include_videos:      true,
  });
  const [files, setFiles] = useState<ReclaimableFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"size" | "name" | "category">("size");
  const [sortAsc, setSortAsc] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ freed: number; errors: string[] } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Obtener paths de búsqueda ──────────────────────────────────────────────
  const getSearchPaths = useCallback(async (): Promise<string[]> => {
    if (searchPaths && searchPaths.length > 0) return searchPaths;
    // Obtener rutas de todos los proyectos + raíz de assets
    try {
      const [projects, storage] = await Promise.all([
        invoke<Array<{ path: string }>>("list_projects"),
        invoke<{ assets_root: string }>("get_storage_stats"),
      ]);
      return [
        ...projects.map((p) => p.path),
        storage.assets_root,
      ].filter(Boolean);
    } catch {
      return [];
    }
  }, [searchPaths]);

  // ── Scan ───────────────────────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    setPhase("scanning");
    setFiles([]);
    setSelected(new Set());
    try {
      const paths = await getSearchPaths();
      const results = await tauriScanReclaimable(paths, options);
      setFiles(results);
      setPhase("results");
    } catch (e) {
      console.error(e);
      setPhase("options");
    }
  }, [options, getSearchPaths]);

  // ── Selección ──────────────────────────────────────────────────────────────
  const toggleSelect = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const visibleFiles = useMemo(() => {
    let f = filterCategory ? files.filter((fi) => fi.category === filterCategory) : [...files];
    f.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "size")     cmp = a.size_bytes - b.size_bytes;
      if (sortBy === "name")     cmp = a.path.localeCompare(b.path);
      if (sortBy === "category") cmp = a.category.localeCompare(b.category);
      return sortAsc ? cmp : -cmp;
    });
    return f;
  }, [files, filterCategory, sortBy, sortAsc]);

  const toggleAll = useCallback(() => {
    if (selected.size === visibleFiles.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleFiles.map((f) => f.path)));
    }
  }, [visibleFiles, selected.size]);

  const selectedBytes = useMemo(() => {
    return files
      .filter((f) => selected.has(f.path))
      .reduce((sum, f) => sum + f.size_bytes, 0);
  }, [files, selected]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    setConfirmOpen(false);
    setPhase("deleting");
    try {
      const result = await tauriDeleteReclaimable([...selected]);
      setDeleteResult({ freed: result.freed_bytes, errors: result.errors });
      setPhase("done");
    } catch (e) {
      setDeleteResult({ freed: 0, errors: [String(e)] });
      setPhase("done");
    }
  }, [selected]);

  // ── Categories presente ────────────────────────────────────────────────────
  const presentCategories = useMemo(() => {
    const cats = new Set(files.map((f) => f.category));
    return [...cats];
  }, [files]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Free Up Space</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Scan projects and assets for heavy or unnecessary files
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Options (phase: options) ─────────────────────────────────────── */}
        {phase === "options" && (
          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
            <p className="text-xs text-zinc-500">
              Choose what to scan for. Only files larger than the minimum size will be listed.
            </p>

            {/* Min size */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400">Minimum file size</label>
              <div className="flex gap-1.5">
                {[
                  { label: "1 MB",  value: 1024 ** 2 },
                  { label: "5 MB",  value: 5 * 1024 ** 2 },
                  { label: "10 MB", value: 10 * 1024 ** 2 },
                  { label: "50 MB", value: 50 * 1024 ** 2 },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setOptions((o) => ({ ...o, min_size_bytes: opt.value }))}
                    className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                      options.min_size_bytes === opt.value
                        ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                        : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Category toggles */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-zinc-400">File types to scan</label>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
                {[
                  { key: "include_source_art",  label: "Source Art (PSD, PSB, AI)", desc: "Photoshop & Illustrator files — usually replaceable by exports" },
                  { key: "include_blender",     label: "Blender files (.blend)",    desc: "3D source files that can be archived if not actively edited" },
                  { key: "include_unity_cache", label: "Unity Library & Temp",      desc: "Regenerable Unity cache — safe to delete, Unity will rebuild" },
                  { key: "include_videos",      label: "Video files",               desc: "MP4/MOV reference videos inside project folders" },
                  { key: "include_logs",        label: "Log files",                 desc: "Text logs — usually low value, rarely > 5 MB" },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm text-zinc-200">{label}</p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">{desc}</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={!!options[key as keyof ScanReclaimableOptions]}
                      onClick={() => setOptions((o) => ({ ...o, [key]: !o[key as keyof ScanReclaimableOptions] }))}
                      className={`relative flex-shrink-0 w-10 h-5 rounded-full border transition-all duration-200 ${
                        options[key as keyof ScanReclaimableOptions]
                          ? "bg-violet-600 border-violet-500/60"
                          : "bg-zinc-800 border-zinc-700"
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                        options[key as keyof ScanReclaimableOptions] ? "left-[calc(100%-18px)]" : "left-0.5"
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Scanning ──────────────────────────────────────────────────────── */}
        {phase === "scanning" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12">
            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-200">Scanning…</p>
              <p className="text-xs text-zinc-500 mt-1">Walking through project folders and assets</p>
            </div>
          </div>
        )}

        {/* ── Results ───────────────────────────────────────────────────────── */}
        {phase === "results" && (
          <>
            {/* Filter bar */}
            <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800 shrink-0 flex-wrap">
              <Filter className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
              <button
                onClick={() => setFilterCategory(null)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                  filterCategory === null
                    ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                All ({files.length})
              </button>
              {presentCategories.map((cat) => {
                const meta = CATEGORY_META[cat];
                const CatIcon = meta?.icon ?? Package;
                const count = files.filter((f) => f.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setFilterCategory(cat === filterCategory ? null : cat)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                      filterCategory === cat
                        ? "border-violet-500/60 bg-violet-600/15 text-violet-300"
                        : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    <CatIcon className={`w-3 h-3 ${meta?.color ?? "text-zinc-400"}`} />
                    {meta?.label ?? cat} ({count})
                  </button>
                );
              })}

              {/* Sort */}
              <div className="ml-auto flex items-center gap-1">
                {(["size", "name", "category"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => { if (sortBy === s) setSortAsc(!sortAsc); else { setSortBy(s); setSortAsc(false); } }}
                    className={`px-2 py-1 rounded text-[10px] font-medium capitalize transition-all ${
                      sortBy === s ? "text-zinc-200 bg-zinc-800" : "text-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    {s} {sortBy === s ? (sortAsc ? "↑" : "↓") : ""}
                  </button>
                ))}
              </div>
            </div>

            {/* Select all */}
            <div className="flex items-center gap-3 px-6 py-2.5 border-b border-zinc-800/60 shrink-0 bg-zinc-900/40">
              <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
                {selected.size === visibleFiles.length && visibleFiles.length > 0
                  ? <CheckSquare className="w-4 h-4 text-violet-400" />
                  : <Square className="w-4 h-4" />
                }
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </button>
              {selected.size > 0 && (
                <span className="text-xs text-emerald-400 ml-auto font-mono">
                  {fmtBytes(selectedBytes)} to free
                </span>
              )}
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50">
              {visibleFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500" />
                  <p className="text-sm text-zinc-400">No heavy files found!</p>
                  <p className="text-xs text-zinc-600">Try lowering the minimum file size or enabling more categories.</p>
                </div>
              ) : (
                visibleFiles.map((file) => {
                  const meta = CATEGORY_META[file.category];
                  const FileIcon = meta?.icon ?? Package;
                  const isSelected = selected.has(file.path);
                  const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
                  return (
                    <button
                      key={file.path}
                      onClick={() => toggleSelect(file.path)}
                      className={`w-full flex items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-zinc-900/60 ${
                        isSelected ? "bg-violet-950/20" : ""
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? "bg-violet-600 border-violet-600" : "border-zinc-700 bg-zinc-900"
                      }`}>
                        {isSelected && <svg className="w-3 h-3 text-white" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>

                      <FileIcon className={`w-4 h-4 shrink-0 ${meta?.color ?? "text-zinc-400"}`} />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-200 truncate font-medium">{fileName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-zinc-600">{file.source_name}</span>
                          <span className="text-[10px] text-zinc-700">·</span>
                          <span className="text-[10px] text-zinc-600">{file.description}</span>
                          {file.is_directory && (
                            <span className="text-[9px] bg-violet-900/40 border border-violet-800/40 text-violet-400 px-1.5 py-px rounded font-semibold">DIR</span>
                          )}
                        </div>
                      </div>

                      <span className="text-xs font-mono text-zinc-400 shrink-0">{fmtBytes(file.size_bytes)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── Deleting ──────────────────────────────────────────────────────── */}
        {phase === "deleting" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12">
            <Loader2 className="w-8 h-8 text-red-400 animate-spin" />
            <p className="text-sm text-zinc-300">Deleting {selected.size} item{selected.size !== 1 ? "s" : ""}…</p>
          </div>
        )}

        {/* ── Done ──────────────────────────────────────────────────────────── */}
        {phase === "done" && deleteResult && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-12">
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-zinc-100">
                Freed {fmtBytes(deleteResult.freed)}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {selected.size} item{selected.size !== 1 ? "s" : ""} deleted
              </p>
            </div>
            {deleteResult.errors.length > 0 && (
              <div className="w-full rounded-xl border border-red-900/40 bg-red-950/20 p-3 max-h-32 overflow-y-auto">
                {deleteResult.errors.map((e, i) => (
                  <p key={i} className="text-[10px] font-mono text-red-400">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Confirm overlay ────────────────────────────────────────────────── */}
        {confirmOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 rounded-2xl">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 shrink-0">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-100">Delete {selected.size} item{selected.size !== 1 ? "s" : ""}?</p>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    This will permanently free <span className="text-zinc-300 font-medium">{fmtBytes(selectedBytes)}</span>.
                    Unity Library folders will be rebuilt by Unity on next open.
                    Source art files cannot be recovered.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2.5">
                <button onClick={() => setConfirmOpen(false)} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium text-white transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete {fmtBytes(selectedBytes)}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4 shrink-0">
          {phase === "options" && (
            <>
              <p className="text-xs text-zinc-600">Will scan all Unity projects and the asset library</p>
              <button
                onClick={handleScan}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
              >
                <Search className="w-4 h-4" /> Scan now
              </button>
            </>
          )}
          {phase === "results" && (
            <>
              <button
                onClick={() => { setPhase("options"); setFiles([]); setSelected(new Set()); }}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Rescan
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={selected.size === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Delete selected
                {selected.size > 0 && <span className="font-mono">({fmtBytes(selectedBytes)})</span>}
              </button>
            </>
          )}
          {(phase === "deleting" || phase === "scanning") && (
            <p className="text-xs text-zinc-600 w-full text-center">Please wait…</p>
          )}
          {phase === "done" && (
            <button
              onClick={onClose}
              className="ml-auto px-5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-200 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
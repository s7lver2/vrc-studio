/**
 * ScanDriveWizard — Wizard de 2 pasos para escanear el disco en busca de assets de VRChat.
 * Paso 1: Configuración (directorio raíz, opciones)
 * Paso 2: Escaneo + análisis en tiempo real + resolución de conflictos + import real
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  X, HardDrive, Search, FolderOpen, ChevronRight, Loader2,
  CheckCircle2, AlertTriangle, MoreHorizontal, Copy, Trash2,
  Layers, SkipForward, Pencil, Check, Plus, Tag,
  Globe, RefreshCw, ChevronDown, ChevronUp,
  TerminalSquare, Package, Upload, Store, Download
} from "lucide-react";
import { tauriGetBoothProductDetail, tauriSearchShop, tauriImportLocalPackage, tauriSetItemProductImages, ShopProduct, tauriCheckDuplicateItems, tauriDeleteInventoryItem, } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { GlobalBoothPickerModal, type BoothPickerResult } from "@/components/shared/GlobalBoothPickerModal";
import { TagInput } from "./TagInput";
import { useT } from "../../i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanStatus = "idle" | "detecting" | "analyzing" | "done" | "error";

interface DetectedFile {
  id: string;
  filePath: string;
  fileName: string;
  ext: "unitypackage" | "zip" | "fbx" | "vrm" | "glb";
  sizeMb: number;
}

interface ScannedItem extends DetectedFile {
  phase: "detecting" | "indexing" | "done" | "conflict";
  name?: string;
  author?: string;
  boothId?: string;
  thumbnailUrl?: string;
  customThumbnailUrl?: string;
  description?: string;
  detectedAvatars?: string[];
  allAvatars?: string[];
  tags?: string[];
  boothUrl?: string;
  boothFound?: boolean;
  productImages?: string[];
  boothSuggestions?: ShopProduct[];
}

type ConflictResolution = "keep_copy" | "delete" | "combine" | "ignore";

interface Conflict {
  id: string;
  item1: ScannedItem;
  item2: ScannedItem;
  description: string;
}

// ── Real scan helpers ─────────────────────────────────────────────────────────

async function realDetect(
  rootDir: string,
  types: Set<string>,
  recursive: boolean,
  abortRef: React.MutableRefObject<boolean>,
  addLog: (msg: string) => void,
): Promise<DetectedFile[]> {
  const { readDir, stat } = await import("@tauri-apps/plugin-fs");
  const results: DetectedFile[] = [];
  const sep = rootDir.includes("\\") ? "\\" : "/";

  async function scanDir(dir: string, depth: number) {
    if (abortRef.current) return;
    const entries = await readDir(dir).catch((e: any) => {
      addLog(`⚠ readDir failed on ${dir}: ${e?.message ?? String(e)}`);
      return [];
    });
    for (const entry of entries as any[]) {
      if (abortRef.current) return;
      const name: string = entry.name ?? "";
      if (!name || name.startsWith(".")) continue;

      const fullPath = `${dir}${sep}${name}`;

      if (entry.isDirectory) {
        if (recursive && depth < 10) await scanDir(fullPath, depth + 1);
      } else {
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (!types.has(ext)) continue;
        let sizeMb = 0;
        try {
          const info = await stat(fullPath);
          sizeMb = Math.round((info.size ?? 0) / (1024 * 1024));
        } catch { /* non-fatal */ }
        results.push({
          id: `file-${results.length}-${Date.now()}`,
          filePath: fullPath,
          fileName: name,
          ext: ext as DetectedFile["ext"],
          sizeMb,
        });
      }
    }
  }

  await scanDir(rootDir, 0);
  return results;
}

function extractBoothId(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]+$/, "");
  const trailingMatch = base.match(/[_\-\s]((\d{5,9}))$/);
  if (trailingMatch) return trailingMatch[1];

  const leadingMatch = base.match(/^((\d{5,9}))[_\-\s]/);
  if (leadingMatch) return leadingMatch[1];

  const bracketMatch = base.match(/[\[\(]((\d{5,9}))[\]\)]/);
  if (bracketMatch) return bracketMatch[1];

  const anyMatches = [...base.matchAll(/(?:^|[^0-9])(\d{5,9})(?:[^0-9]|$)/g)];
  const candidates = anyMatches.map(m => m[1]);
  return candidates.length > 0 ? candidates.sort((a, b) => b.length - a.length)[0] : null;
}

function cleanDisplayName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/(?:^|[^0-9])(\d{6,8})(?:[^0-9]|$)/g, " ")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Helpers para construir queries de búsqueda desde nombre de archivo ────────

function buildBoothSearchQueries(fileName: string): string[] {
  const base = fileName.replace(/\.(zip|unitypackage|fbx|vrm|glb)$/i, "");
  const queries: string[] = [];

  // 1. Nombre limpio completo: "SomeName_Karin_v1.2" → "SomeName Karin"
  const clean = base
    .replace(/(?:^|[^0-9])(\d{6,8})(?:[^0-9]|$)/g, " ")  // quitar IDs numéricos
    .replace(/_v[\d.]+$/i, "")                              // quitar versión final
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length >= 3) queries.push(clean);

  // 2. Solo las primeras 2-3 palabras (el nombre del producto sin el avatar base)
  const words = clean.split(" ").filter(Boolean);
  if (words.length >= 3) {
    queries.push(words.slice(0, 2).join(" "));
  }

  // 3. Si hay un guion bajo separador reconocible, usar solo la primera parte
  const underParts = base.split("_").filter(Boolean);
  if (underParts.length >= 2 && underParts[0].length >= 3) {
    const firstPart = underParts[0];
    if (!queries.includes(firstPart)) queries.push(firstPart);
  }

  return [...new Set(queries)].filter((q) => q.length >= 3).slice(0, 2);
}

async function realAnalyze(file: DetectedFile): Promise<Partial<ScannedItem>> {
  const displayName = cleanDisplayName(file.fileName) || file.fileName;
  const boothId = extractBoothId(file.fileName);

  // ── Camino 1: ID numérico en el nombre de archivo ─────────────────────────
  if (boothId) {
    try {
      const detail = await tauriGetBoothProductDetail(boothId);
      return {
        phase: "done",
        name: detail.name || displayName,
        author: detail.author || undefined,
        boothId: detail.source_id,
        boothUrl: detail.url,
        thumbnailUrl: detail.images?.[0] ?? undefined,
        productImages: detail.images ?? [],
        description: detail.description || undefined,
        boothFound: true,
        boothSuggestions: [],
        detectedAvatars: [],
        allAvatars: [],
        tags: [],
      };
    } catch { /* not found on Booth, fall through */ }
  }

  // ── Camino 2: búsqueda por nombre — obtener top 2 sugerencias ─────────────
  const queries = buildBoothSearchQueries(file.fileName);
  let suggestions: ShopProduct[] = [];

  for (const q of queries) {
    if (suggestions.length >= 2) break;
    try {
      const results = await tauriSearchShop(q, 1);
      const boothResults = results
        .filter((p) => p.source === "booth")
        .slice(0, 2 - suggestions.length);
      suggestions = [...suggestions, ...boothResults];
    } catch { /* search failed, skip */ }
  }

  // Deduplicar por source_id
  const seen = new Set<string>();
  suggestions = suggestions.filter((p) => {
    if (seen.has(p.source_id)) return false;
    seen.add(p.source_id);
    return true;
  }).slice(0, 2);

  return {
    phase: "done",
    name: displayName,
    boothFound: false,
    boothSuggestions: suggestions,
    thumbnailUrl: undefined,
    detectedAvatars: [],
    allAvatars: [],
    tags: [],
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ExtBadge({ ext }: { ext: string }) {
  const colors: Record<string, string> = {
    unitypackage: "bg-blue-900/50 text-blue-300 border-blue-700/50",
    zip: "bg-zinc-700/50 text-zinc-300 border-zinc-600/50",
    fbx: "bg-purple-900/50 text-purple-300 border-purple-700/50",
    vrm: "bg-pink-900/50 text-pink-300 border-pink-700/50",
    glb: "bg-emerald-900/50 text-emerald-300 border-emerald-700/50",
  };
  return (
    <span className={`text-[9px] font-mono uppercase px-1.5 py-px rounded border ${colors[ext] ?? "bg-zinc-700 text-zinc-400 border-zinc-600"}`}>
      .{ext}
    </span>
  );
}

function AvatarPill({ name, included }: { name: string; included: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${included
      ? "bg-green-900/40 text-green-300 border-green-700/50"
      : "bg-zinc-800 text-zinc-500 border-zinc-700/50 line-through"
      }`}>
      {included && <Check className="h-2.5 w-2.5" />}
      {name}
    </span>
  );
}

// ── Booth Search Popup ────────────────────────────────────────────────────────

function BoothSearchPopup({
  onClose, onSelect,
}: {
  onClose: () => void;
  onSelect: (product: ShopProduct) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const doSearch = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await tauriSearchShop(q.trim(), 1);
      setResults(res.filter((p) => p.source === "booth"));
    } catch (e: any) {
      setError(e?.message ?? t("scan_wizard_search_no_results"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
          <Globe className="h-4 w-4 text-pink-400" />
          <span className="text-sm font-semibold text-zinc-100">{t("scan_wizard_search_title")}</span>
          <button onClick={onClose} className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="px-4 py-3 shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-pink-500 transition-colors"
              placeholder={t("scan_wizard_search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch(query)}
            />
            <button
              onClick={() => doSearch(query)}
              disabled={loading || !query.trim()}
              className="px-3 py-2 rounded-lg bg-pink-700 hover:bg-pink-600 disabled:opacity-40 text-white text-xs font-medium transition-colors flex items-center gap-1"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {t("scan_wizard_search_button")}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
          {results.length === 0 && !loading && query && (
            <p className="text-xs text-zinc-600 text-center py-6">{t("scan_wizard_search_no_results")}</p>
          )}
          {results.map((product) => (
            <button
              key={product.source_id}
              onClick={() => { onSelect(product); onClose(); }}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-zinc-800 hover:border-pink-700/50 hover:bg-pink-950/20 text-left transition-all group"
            >
              {product.thumbnail_url ? (
                <img src={product.thumbnail_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 bg-zinc-800" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0"><Package className="h-5 w-5 text-zinc-600" /></div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate group-hover:text-pink-200">{product.name}</p>
                <p className="text-[10px] text-zinc-500 truncate">{product.author}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] text-pink-400 bg-pink-900/30 px-1.5 py-px rounded-full border border-pink-700/40">#{product.source_id}</span>
                  <span className="text-[9px] text-zinc-600">{product.price_display}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Item Edit Popup ───────────────────────────────────────────────────────────

function ItemEditPopup({
  item, onClose, onSave,
}: {
  item: ScannedItem;
  onClose: () => void;
  onSave: (updated: Partial<ScannedItem>) => void;
}) {
  const t = useT();
  const [name, setName] = useState(item.name ?? "");
  const [author, setAuthor] = useState(item.author ?? "");
  const [boothId, setBoothId] = useState(item.boothId ?? "");
  const [showAvatarSuggestions, setShowAvatarSuggestions] = useState(false);
  const [tags, setTags] = useState<string[]>(item.tags ?? []);
  const [avatars, setAvatars] = useState<string[]>(item.detectedAvatars ?? []);
  const [newAvatar, setNewAvatar] = useState("");
  const [showBoothSearch, setShowBoothSearch] = useState(false);
  const [lookingUpBooth, setLookingUpBooth] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inventoryItems = useInventoryStore((s) => s.items);
  const [localBoothFound, setLocalBoothFound] = useState<boolean | null>(null);

  const avatarSuggestions = useMemo(() => {
    if (!newAvatar.trim()) return [];
    const q = newAvatar.toLowerCase();
    return inventoryItems
      .filter((item) =>
        item.tags.some((t) => ["avatar", "base", "vrchat_avatar", "avatar_base", "vrm"].includes(t.toLowerCase()))
        && item.name.toLowerCase().includes(q)
        && !avatars.includes(item.name)
      )
      .slice(0, 8);
  }, [newAvatar, inventoryItems, avatars]);

  const [thumbnailUrl, setThumbnailUrl] = useState(item.customThumbnailUrl ?? "");
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(
    item.customThumbnailUrl || item.thumbnailUrl || null
  );
  const [thumbnailLoading, setThumbnailLoading] = useState(false);
  const [detailImages, setDetailImages] = useState<string[]>(item.productImages ?? []);
  const [fetchingImages, setFetchingImages] = useState(false);

  // ── handlers ──────────────────────────────────────────────────────────────
  const fetchAndApplyBoothDetail = async (id: string) => {
    if (!id.trim()) return;
    setFetchingImages(true);
    try {
      const detail = await tauriGetBoothProductDetail(id.trim());
      if (detail.name && !name) setName(detail.name);
      if (detail.author && !author) setAuthor(detail.author);
      if (detail.images?.[0]) {
        setThumbnailUrl(detail.images[0]);
        setThumbnailPreview(detail.images[0]);
      }
      setDetailImages(detail.images ?? []);
      setLocalBoothFound(true);
    } catch {
      setLocalBoothFound(false);
    } finally {
      setFetchingImages(false);
    }
  };

  const pickLocalThumbnail = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
      });
      if (typeof selected === "string") {
        setThumbnailLoading(true);
        try {
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          setThumbnailUrl(convertFileSrc(selected));
          setThumbnailPreview(convertFileSrc(selected));
        } catch {
          setThumbnailUrl(selected);
          setThumbnailPreview(selected);
        }
        setThumbnailLoading(false);
      }
    } catch { /* dialog plugin not available */ }
  };

  const addAvatar = () => {
    const a = newAvatar.trim();
    if (a && !avatars.includes(a)) setAvatars([...avatars, a]);
    setNewAvatar("");
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-2.5">
              <Pencil className="h-4 w-4 text-zinc-400" />
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{t("scan_wizard_edit_title")}</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-px truncate max-w-xs">{item.fileName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Body ──────────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">

            {/* ① Thumbnail row */}
            <div className="flex gap-4 items-start">
              {/* Preview square */}
              <div className="shrink-0 w-24 h-24 rounded-xl bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center">
                {thumbnailLoading ? (
                  <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
                ) : thumbnailPreview ? (
                  <img src={thumbnailPreview} alt="" className="w-full h-full object-cover" onError={() => setThumbnailPreview(null)} />
                ) : (
                  <Package className="h-7 w-7 text-zinc-600" />
                )}
              </div>

              {/* Thumbnail actions */}
              <div className="flex-1 flex flex-col gap-2">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Thumbnail</p>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-zinc-500 transition-colors"
                  placeholder="Paste image URL…"
                  value={thumbnailUrl}
                  onChange={(e) => { setThumbnailUrl(e.target.value); setThumbnailPreview(e.target.value || null); }}
                />
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={pickLocalThumbnail} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors">
                    <Upload className="h-3 w-3" /> Pick file
                  </button>
                  {thumbnailPreview && (
                    <button onClick={() => { setThumbnailUrl(""); setThumbnailPreview(null); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-zinc-500 hover:text-red-400 text-xs transition-colors">
                      <X className="h-3 w-3" /> Clear
                    </button>
                  )}
                  {item.thumbnailUrl && thumbnailUrl !== item.thumbnailUrl && (
                    <button onClick={() => { setThumbnailUrl(item.thumbnailUrl!); setThumbnailPreview(item.thumbnailUrl!); }} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1.5">
                      ↺ Restore Booth
                    </button>
                  )}
                </div>

                {/* Product image strip (only if >1) */}
                {detailImages.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap mt-1">
                    {detailImages.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => { setThumbnailUrl(url); setThumbnailPreview(url); }}
                        className={`w-10 h-10 rounded-lg overflow-hidden border-2 transition-all ${thumbnailUrl === url ? "border-red-500" : "border-zinc-700 hover:border-zinc-500"}`}
                      >
                        <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ② Name + Author (2-column) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{t("scan_wizard_edit_name")}</label>
                <input className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{t("scan_wizard_edit_author")}</label>
                <input className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors" value={author} onChange={(e) => setAuthor(e.target.value)} />
              </div>
            </div>

            {/* ③ Booth Association card */}
            <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-pink-900/40 bg-pink-950/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-pink-400/80 uppercase tracking-wider flex items-center gap-1.5">
                  <Store className="h-3 w-3" /> Booth Association
                  {!(localBoothFound ?? item.boothFound) && (
                    <span className="text-[9px] text-amber-400 bg-amber-900/30 px-1.5 py-px rounded-full border border-amber-700/50 font-normal normal-case tracking-normal">
                      not linked
                    </span>
                  )}
                </p>
              </div>
              {/* Booth ID input + manual fetch */}
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-pink-500 transition-colors"
                  placeholder="Booth item ID (e.g., 1234567)"
                  value={boothId}
                  onChange={(e) => setBoothId(e.target.value)}
                />
                <button
                  onClick={() => fetchAndApplyBoothDetail(boothId)}
                  disabled={!boothId.trim() || fetchingImages}
                  className="px-2 py-1.5 rounded-lg bg-pink-800 hover:bg-pink-700 disabled:opacity-40 text-white text-[10px] font-medium transition-colors flex items-center gap-1"
                >
                  {fetchingImages ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                  Fetch
                </button>
                <button
                  onClick={() => setShowBoothSearch(true)}
                  className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-[10px] transition-colors"
                >
                  Search
                </button>
              </div>
              {boothId && (
                <a href={`https://booth.pm/en/items/${boothId}`} target="_blank" rel="noreferrer" className="text-[10px] text-pink-500 hover:text-pink-300 transition-colors">
                  booth.pm/en/items/{boothId} ↗
                </a>
              )}

              {/* Suggestions accordion */}
              {!item.boothFound && item.boothSuggestions && item.boothSuggestions.length > 0 && (
                <div className="flex flex-col gap-2 pt-1 border-t border-pink-900/30">
                  <button
                    className="flex items-center gap-1.5 text-xs text-pink-400/70 hover:text-pink-300 transition-colors"
                    onClick={() => setShowSuggestions((v) => !v)}
                  >
                    {showSuggestions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {item.boothSuggestions.length} possible match{item.boothSuggestions.length !== 1 ? "es" : ""}
                  </button>
                  {showSuggestions && (
                    <div className="flex flex-col gap-1.5">
                      {item.boothSuggestions.map((product) => (
                        <button
                          key={product.source_id}
                          type="button"
                          onClick={() => { setBoothId(product.source_id); fetchAndApplyBoothDetail(product.source_id); setShowSuggestions(false); }}
                          className="flex items-center gap-3 px-3 py-2 rounded-xl border border-zinc-700/60 bg-zinc-800/40 hover:border-pink-600/50 hover:bg-pink-950/20 transition-all text-left group"
                        >
                          {product.thumbnail_url ? (
                            <img src={product.thumbnail_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-zinc-700 shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 shrink-0 flex items-center justify-center">
                              <Package className="h-4 w-4 text-zinc-600" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-zinc-200 truncate">{product.name}</p>
                            <p className="text-[10px] text-zinc-500 truncate">{product.author} · {product.price_display}</p>
                          </div>
                          <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-pink-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ④ Avatars */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{t("scan_wizard_edit_avatar_label")}</label>
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {avatars.map((a) => (
                  <button key={a} onClick={() => setAvatars(avatars.filter((x) => x !== a))} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-700/50 hover:bg-red-900/40 hover:text-red-300 hover:border-red-700/50 transition-colors group">
                    {a} <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                  </button>
                ))}
                {item.allAvatars?.filter((a) => !avatars.includes(a)).map((a) => (
                  <button key={a} onClick={() => setAvatars([...avatars, a])} className="text-[10px] px-2 py-0.5 rounded-full text-zinc-500 border border-dashed border-zinc-700 hover:border-zinc-500 hover:text-zinc-300 transition-colors">
                    + {a}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 transition-colors" placeholder={t("scan_wizard_edit_add_avatar")} value={newAvatar} onChange={(e) => setNewAvatar(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAvatar()} />
                <button onClick={addAvatar} className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* ⑤ Tags */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
                <Tag className="h-3 w-3" /> {t("scan_wizard_edit_tags")}
              </label>
              <TagInput tags={tags} onChange={setTags} placeholder={t("scan_wizard_edit_add_tag")} />
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800">
            <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
              {t("scan_wizard_cancel")}
            </button>
            <button
              onClick={() => {
                onSave({
                  name,
                  author,
                  boothId: boothId || undefined,
                  detectedAvatars: avatars,
                  tags,
                  customThumbnailUrl: thumbnailUrl || undefined,
                  productImages: detailImages,
                  boothFound: localBoothFound ?? item.boothFound,
                });
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
            >
              {t("scan_wizard_save_changes")}
            </button>
          </div>
        </div>
      </div>

      {showBoothSearch && (
        <BoothSearchPopup
          onClose={() => setShowBoothSearch(false)}
          onSelect={(product) => {
            setBoothId(product.source_id);
            if (product.name) setName(product.name);
            if (product.author) setAuthor(product.author);
            if (product.thumbnail_url && !thumbnailUrl) { setThumbnailUrl(product.thumbnail_url); setThumbnailPreview(product.thumbnail_url); }
          }}
        />
      )}
    </>
  );
}

function DuplicateBatchDialog({
  duplicates,
  onSkipAll,
  onOverwriteAll,
  onCancel,
}: {
  duplicates: { name: string; existingIds: string[] }[];
  onSkipAll: () => void;
  onOverwriteAll: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">Duplicates detected</p>
            <p className="text-xs text-zinc-400 mt-1">
              {duplicates.length} item(s) already exist in your inventory. How would you like to proceed?
            </p>
            <ul className="mt-2 text-xs text-zinc-500 list-disc list-inside">
              {duplicates.slice(0, 5).map((d, i) => (
                <li key={i} className="truncate">{d.name}</li>
              ))}
              {duplicates.length > 5 && <li>...and {duplicates.length - 5} more</li>}
            </ul>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSkipAll}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            Skip duplicates
          </button>
          <button
            onClick={onOverwriteAll}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors"
          >
            Overwrite all
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Conflict Popup ────────────────────────────────────────────────────────────

function ConflictPopup({
  conflict, onResolve,
}: {
  conflict: Conflict;
  onResolve: (resolution: ConflictResolution, conflictId: string) => void;
}) {
  const t = useT();
  const OPTIONS: { id: ConflictResolution; icon: React.ReactNode; label: string; desc: string; danger?: boolean }[] = [
    { id: "keep_copy", icon: <Copy className="h-4 w-4" />, label: t("scan_wizard_keep_copy"), desc: t("scan_wizard_keep_copy_desc") },
    { id: "combine", icon: <Layers className="h-4 w-4" />, label: t("scan_wizard_combine"), desc: t("scan_wizard_combine_desc") },
    { id: "delete", icon: <Trash2 className="h-4 w-4" />, label: t("scan_wizard_delete_item"), desc: t("scan_wizard_delete_item_desc"), danger: true },
    { id: "ignore", icon: <SkipForward className="h-4 w-4" />, label: t("scan_wizard_ignore"), desc: t("scan_wizard_ignore_desc") },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-amber-800/60 rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-zinc-800">
          <div className="h-8 w-8 rounded-lg bg-amber-900/50 border border-amber-700/60 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{t("scan_wizard_conflict_title")}</h3>
            <p className="text-xs text-zinc-500">{conflict.description}</p>
          </div>
        </div>

        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          {[conflict.item1, conflict.item2].map((item, i) => (
            <div key={i} className="bg-zinc-800/60 rounded-xl border border-zinc-700 p-3 flex flex-col gap-2">
              {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="w-full aspect-video object-cover rounded-lg" />}
              <p className="text-xs font-medium text-zinc-200 truncate">{item.name ?? item.fileName}</p>
              <p className="text-[10px] text-zinc-500">{item.author ?? "Unknown"}</p>
              {item.detectedAvatars && item.detectedAvatars.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.detectedAvatars.map((a) => (
                    <span key={a} className="text-[9px] px-1.5 py-px rounded-full bg-green-900/40 text-green-300 border border-green-700/50">{a}</span>
                  ))}
                </div>
              )}
              <ExtBadge ext={item.ext} />
            </div>
          ))}
        </div>

        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          {OPTIONS.map(({ id, icon, label, desc, danger }) => (
            <button key={id} onClick={() => onResolve(id, conflict.id)}
              className={`flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] ${danger ? "bg-red-950/30 border-red-800/50 hover:bg-red-950/60 hover:border-red-700" : "bg-zinc-800/50 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600"
                }`}>
              <div className={`${danger ? "text-red-400" : "text-zinc-300"}`}>{icon}</div>
              <span className={`text-xs font-medium ${danger ? "text-red-300" : "text-zinc-200"}`}>{label}</span>
              <span className="text-[10px] text-zinc-500 leading-relaxed">{desc}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Scanned Item Row (con checkbox) ───────────────────────────────────────────

function ScannedItemRow({
  item,
  isSelected,
  onToggleSelect,
  onEdit,
  onRemove,
}: {
  item: ScannedItem;
  isSelected: boolean;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
  onEdit: () => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  const handleRowClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onToggleSelect(item.id, true);
    } else {
      onToggleSelect(item.id, false);
    }
  };

  return (
    <div className={`rounded-xl border transition-all ${item.phase === "conflict"
      ? "border-amber-700/60 bg-amber-950/20"
      : item.phase === "done"
        ? "border-zinc-800 bg-zinc-900/50"
        : "border-zinc-800/50 bg-zinc-900/30"
      }`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Checkbox */}
        <div
          className={`shrink-0 w-4 h-4 rounded border transition-all ${isSelected
            ? "bg-red-600 border-red-600"
            : "bg-zinc-800 border-zinc-600 hover:border-zinc-400"
            } flex items-center justify-center cursor-pointer`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(item.id, false);
          }}
        >
          {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
        </div>

        <div className="shrink-0 w-5 flex items-center justify-center">
          {item.phase === "detecting" && <Loader2 className="h-3.5 w-3.5 text-zinc-500 animate-spin" />}
          {item.phase === "indexing" && <Search className="h-3.5 w-3.5 text-blue-400 animate-pulse" />}
          {item.phase === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
          {item.phase === "conflict" && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
        </div>

        <div className="shrink-0 w-9 h-9 rounded-lg bg-zinc-800 overflow-hidden cursor-pointer" onClick={handleRowClick}>
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : item.phase === "indexing" ? (
            <div className="w-full h-full bg-zinc-700 animate-pulse" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><Package className="h-4 w-4 text-zinc-600" /></div>
          )}
        </div>

        <div className="flex-1 min-w-0 cursor-pointer" onClick={handleRowClick}>
          {item.phase === "detecting" || item.phase === "indexing" ? (
            <div className="flex flex-col gap-1">
              {item.phase === "detecting" ? (
                <p className="text-xs text-zinc-400 truncate font-mono">{item.fileName}</p>
              ) : (
                <>
                  <div className="h-3 bg-zinc-700 rounded animate-pulse w-32" />
                  <div className="h-2.5 bg-zinc-800 rounded animate-pulse w-20 mt-0.5" />
                </>
              )}
            </div>
          ) : (
            <>
              <p className="text-xs font-medium text-zinc-200 truncate">{item.name ?? item.fileName}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[10px] text-zinc-500 truncate">{item.author ?? "Unknown"}</p>
                {item.boothId && (
                  <span className="text-[9px] text-pink-400 bg-pink-900/30 px-1.5 py-px rounded-full border border-pink-700/40">Booth #{item.boothId}</span>
                )}
                {!(item.boothFound) && item.phase === "done" && (
                  <span className="text-[9px] text-zinc-600 bg-zinc-800 px-1.5 py-px rounded-full border border-zinc-700">{t("scan_wizard_not_on_booth")}</span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <ExtBadge ext={item.ext} />
          <span className="text-[10px] text-zinc-600">{item.sizeMb}MB</span>
          {item.phase === "done" && item.detectedAvatars && item.allAvatars && (
            <span className={`text-[9px] px-1.5 py-px rounded-full border ${item.detectedAvatars.length < item.allAvatars.length
              ? "text-amber-300 bg-amber-900/30 border-amber-700/50"
              : "text-green-300 bg-green-900/30 border-green-700/50"
              }`}>
              {item.detectedAvatars.length}/{item.allAvatars.length} avatars
            </span>
          )}
          {item.phase === "done" && (
            <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
          <button className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors" onClick={onEdit} title={t("scan_wizard_edit_title")}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-900/30 text-zinc-600 hover:text-red-400 transition-colors"
            onClick={() => onRemove(item.id)}
            title="Remove from list"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && item.phase === "done" && (
        <div className="px-3 pb-3 border-t border-zinc-800/50 pt-2.5 flex flex-col gap-2">
          {item.allAvatars && item.allAvatars.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-zinc-500 font-medium">{t("scan_wizard_avatar_coverage")}</p>
              <div className="flex flex-wrap gap-1">
                {item.allAvatars.map((a) => (
                  <AvatarPill key={a} name={a} included={item.detectedAvatars?.includes(a) ?? false} />
                ))}
              </div>
            </div>
          )}
          {item.description && (
            <p className="text-[10px] text-zinc-500 leading-relaxed line-clamp-2">{item.description}</p>
          )}
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map((t) => (
                <span key={t} className="text-[9px] px-1.5 py-px rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">{t}</span>
              ))}
            </div>
          )}
          <p className="text-[10px] text-zinc-700 font-mono truncate">{item.filePath}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
  onComplete?: (count: number) => void;
}

export function ScanDriveWizard({ onClose, onComplete }: Props) {
  const t = useT();
  const [step, setStep] = useState<1 | 2>(1);

  const [boothPickerOpen, setBoothPickerOpen] = useState(false);
  const [boothPickerForItemId, setBoothPickerForItemId] = useState<string | null>(null);
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [scanTypes, setScanTypes] = useState<Set<string>>(new Set(["unitypackage", "zip", "fbx", "vrm", "glb"]));

  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [detectedFiles, setDetectedFiles] = useState<DetectedFile[]>([]);
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [editItem, setEditItem] = useState<ScannedItem | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [importPhase, setImportPhase] = useState<"idle" | "importing" | "done" | "error">("idle");
  const [importDone, setImportDone] = useState(0);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scanAbortRef = useRef(false);
  const [duplicateBatch, setDuplicateBatch] = useState<{ name: string; existingIds: string[] }[] | null>(null);
  const [duplicateHandling, setDuplicateHandling] = useState<"skip" | "overwrite" | null>(null);
  const { fetchAll } = useInventoryStore();

  // Multi‑selection state
  const [selectedScanIds, setSelectedScanIds] = useState<Set<string>>(new Set());
  const lastSelectedScanId = useRef<string | null>(null);

  const toggleScanSelect = (id: string, shiftKey: boolean = false) => {
    if (shiftKey && lastSelectedScanId.current !== null) {
      // Shift+click range selection
      const allIds = items.map(i => i.id);
      const anchorIdx = allIds.indexOf(lastSelectedScanId.current);
      const targetIdx = allIds.indexOf(id);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
        const rangeIds = allIds.slice(start, end + 1);
        setSelectedScanIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach(i => next.add(i));
          return next;
        });
        lastSelectedScanId.current = id;
        return;
      }
    }
    // Normal toggle
    setSelectedScanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastSelectedScanId.current = id;
      return next;
    });
  };

  const clearScanSelection = () => {
    setSelectedScanIds(new Set());
    lastSelectedScanId.current = null;
  };

  const addLog = useCallback((msg: string) => {
    setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const toggleScanType = (t: string) => {
    setScanTypes((s) => { const next = new Set(s); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  };

  const openBoothPicker = (itemId: string) => {
    setBoothPickerForItemId(itemId);
    setBoothPickerOpen(true);
  };

  const handleBoothSelect = (result: BoothPickerResult) => {
    if (!boothPickerForItemId) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === boothPickerForItemId
          ? { ...item, boothId: result.boothId, name: result.name, author: result.author, thumbnailUrl: result.thumbnailUrl, boothUrl: result.url, boothFound: true }
          : item
      )
    );
  };

  const startScan = async () => {
    setStep(2);
    setScanStatus("detecting");
    scanAbortRef.current = false;
    setItems([]);
    setDetectedFiles([]);
    setLogs([]);
    setProgress(0);
    clearScanSelection();

    if (!rootDir) {
      setScanStatus("error");
      return;
    }

    addLog(`Starting scan in: ${rootDir}`);
    addLog(`Options: recursive=${recursive}, types=[${[...scanTypes].join(",")}]`);

    let detected: DetectedFile[] = [];
    try {
      detected = await realDetect(rootDir!, scanTypes, recursive, scanAbortRef, addLog);
    } catch (e: any) {
      addLog(`Error scanning drive: ${e?.message ?? e}`);
      setScanStatus("error");
      return;
    }

    if (scanAbortRef.current) return;

    if (detected.length === 0) {
      addLog("No matching files found.");
      setScanStatus("done");
      return;
    }

    addLog(`Found ${detected.length} candidate files`);
    setDetectedFiles(detected);

    const initial: ScannedItem[] = detected.map((f) => ({ ...f, phase: "detecting" }));
    setItems(initial);
    setScanStatus("analyzing");
    addLog("Beginning deep analysis…");

    for (let i = 0; i < detected.length; i++) {
      if (scanAbortRef.current) break;
      const file = detected[i];
      setItems((prev) => prev.map((it) => it.id === file.id ? { ...it, phase: "indexing" } : it));
      addLog(`Analyzing ${file.fileName}…`);

      const result = await realAnalyze(file);
      addLog(`  → ${result.boothFound ? `Found on Booth #${result.boothId}` : "Not found on Booth"}`);

      setItems((prev) => prev.map((it) => it.id === file.id ? { ...it, ...result, phase: "done" } : it));
      setProgress(Math.round(((i + 1) / detected.length) * 100));
    }

    setScanStatus("done");
    addLog(`Scan complete. ${detected.length} items ready to import.`);
    clearScanSelection();
  };

  const handleConflictResolve = (resolution: ConflictResolution) => {
    addLog(`Conflict resolved: ${resolution}`);
    setConflict(null);
    (window as any).__conflictResolve?.();
  };

  const updateItem = (id: string, updates: Partial<ScannedItem>) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, ...updates } : it
      )
    );
  };

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setSelectedScanIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const checkAllDuplicates = async (itemsToCheck: ScannedItem[]): Promise<{ name: string; existingIds: string[] }[]> => {
    const results: { name: string; existingIds: string[] }[] = [];
    for (const item of itemsToCheck) {
      try {
        const check = await tauriCheckDuplicateItems(item.name ?? item.fileName, item.filePath);
        if (check.exists) {
          results.push({ name: item.name ?? item.fileName, existingIds: check.existing_item_ids });
        }
      } catch (e) {
        addLog(`Duplicate check failed for ${item.fileName}: ${e}`);
      }
    }
    return results;
  };

  const importSpecificItems = async (itemsToImport: ScannedItem[], skipDuplicates: boolean, overwrite: boolean) => {
    if (itemsToImport.length === 0) return;

    setImportPhase("importing");
    setImportDone(0);
    setImportErrors([]);

    const errors: string[] = [];
    for (let i = 0; i < itemsToImport.length; i++) {
      const item = itemsToImport[i];
      const itemName = item.name ?? item.fileName;

      try {
        if (overwrite) {
          // For overwrite we need to know existing IDs. We'll check duplicates again per item.
          try {
            const check = await tauriCheckDuplicateItems(itemName, item.filePath);
            if (check.exists) {
              await Promise.all(check.existing_item_ids.map(id => tauriDeleteInventoryItem(id, "InventoryOnly")));
            }
          } catch (e) {
            addLog(`Overwrite check failed for ${item.fileName}: ${e}`);
          }
        }

        const newId = await tauriImportLocalPackage({
          zip_path: item.filePath,
          name: itemName,
          author: item.author ?? undefined,
          thumbnail_url: item.customThumbnailUrl ?? item.thumbnailUrl ?? undefined,
          booth_id: item.boothId ?? undefined,
          overwrite,
        });

        if (item.productImages && item.productImages.length > 0) {
          await tauriSetItemProductImages(newId, item.productImages).catch(() => { });
        }
        addLog(`✓ Imported: ${itemName}`);
      } catch (e: any) {
        const msg = `✗ Failed: ${item.fileName} — ${e?.message ?? String(e)}`;
        errors.push(msg);
        addLog(msg);
      }
      setImportDone(i + 1);
    }

    setImportErrors(errors);
    setImportPhase(errors.length > 0 ? "error" : "done");
    await fetchAll();
    onComplete?.(itemsToImport.length - errors.length);
    clearScanSelection();
    // Remove imported items from scan list
    setItems((prev) => prev.filter(i => !itemsToImport.includes(i)));
  };

  const handleImportAll = async () => {
    const readyItems = items.filter(i => i.phase === "done");
    if (readyItems.length === 0) return;
    const dups = await checkAllDuplicates(readyItems);
    if (dups.length > 0) {
      setDuplicateBatch(dups);
      // Store the items to import for later use after duplicate resolution
      (window as any).__pendingImportItems = readyItems;
    } else {
      await importSpecificItems(readyItems, false, false);
    }
  };

  const handleImportSelected = async () => {
    const selectedItems = items.filter(i => selectedScanIds.has(i.id) && i.phase === "done");
    if (selectedItems.length === 0) return;
    const dups = await checkAllDuplicates(selectedItems);
    if (dups.length > 0) {
      setDuplicateBatch(dups);
      (window as any).__pendingImportItems = selectedItems;
    } else {
      await importSpecificItems(selectedItems, false, false);
    }
  };

  const handleCancelSelected = () => {
    setItems((prev) => prev.filter(i => !selectedScanIds.has(i.id)));
    clearScanSelection();
  };

  const doneCount = items.filter((i) => i.phase === "done").length;

  // When duplicate batch is resolved, we resume with the stored items
  useEffect(() => {
    if (duplicateBatch === null && (window as any).__pendingImportItems) {
      importSpecificItems((window as any).__pendingImportItems, true, false);
      delete (window as any).__pendingImportItems;
    }
  }, [duplicateBatch]);

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center">
                <HardDrive className="h-4.5 w-4.5 text-red-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">{t("scan_wizard_title")}</h2>
                <p className="text-[11px] text-zinc-500">
                  {step === 1 ? t("scan_wizard_step1") : scanStatus === "done" ? `${doneCount} items analyzed` : t("scan_wizard_step2")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {[1, 2].map((s) => (
                <div key={s} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${step === s
                  ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                  : s < step
                    ? "bg-green-900/40 border-green-700/50 text-green-400"
                    : "bg-zinc-900 border-zinc-800 text-zinc-600"
                  }`}>
                  {s < step ? <CheckCircle2 className="h-3 w-3" /> : <span className="w-3 h-3 flex items-center justify-center text-[10px] font-mono">{s}</span>}
                  <span>{s === 1 ? t("scan_wizard_step1") : t("scan_wizard_step2")}</span>
                </div>
              ))}
              <button onClick={onClose} className="ml-2 h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {step === 1 && (
            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-300">{t("scan_wizard_root_label")}</label>
                <p className="text-[11px] text-zinc-500">{t("scan_wizard_recursive_desc")}</p>
                <div className="flex gap-2">
                  <div className={`flex-1 flex items-center gap-2 bg-zinc-800 border rounded-lg px-3 py-2 text-sm transition-colors ${rootDir ? "border-zinc-700 text-zinc-200" : "border-dashed border-zinc-600 text-zinc-600"
                    }`}>
                    {rootDir ? (
                      <span className="truncate font-mono text-xs">{rootDir}</span>
                    ) : (
                      <span className="text-xs italic">{t("scan_wizard_root_placeholder")}</span>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const { open } = await import("@tauri-apps/plugin-dialog");
                        const selected = await open({ directory: true, multiple: false });
                        if (typeof selected === "string") setRootDir(selected);
                      } catch { }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 text-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t("scan_wizard_browse")}
                  </button>
                </div>
                {rootDir && (
                  <button onClick={() => setRootDir(null)} className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                    {t("scan_wizard_clear")}
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-zinc-200">{t("scan_wizard_recursive_label")}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{t("scan_wizard_recursive_desc")}</p>
                </div>
                <button
                  onClick={() => setRecursive((v) => !v)}
                  className={`relative h-5 w-9 rounded-full border transition-all ${recursive ? "bg-red-600 border-red-700" : "bg-zinc-700 border-zinc-600"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all shadow ${recursive ? "left-4" : "left-0.5"}`} />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-300">{t("scan_wizard_types_label")}</label>
                <div className="flex flex-wrap gap-2">
                  {(["unitypackage", "zip", "fbx", "vrm", "glb"] as const).map((ext) => (
                    <button key={ext} onClick={() => toggleScanType(ext)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${scanTypes.has(ext) ? "bg-red-900/40 border-red-700 text-red-300" : "bg-zinc-800 border-zinc-700 text-zinc-500"
                        }`}>
                      {scanTypes.has(ext) && <Check className="h-3 w-3" />}
                      .{ext}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-blue-950/30 border border-blue-800/50 px-4 py-3 flex flex-col gap-1">
                <p className="text-xs font-medium text-blue-300 flex items-center gap-1.5"><Search className="h-3.5 w-3.5" /> {t("scan_wizard_info_title")}</p>
                <ul className="text-[11px] text-blue-400/80 space-y-1 list-disc list-inside leading-relaxed">
                  <li>{t("scan_wizard_info_step1")}</li>
                  <li>{t("scan_wizard_info_step2")}</li>
                  <li>{t("scan_wizard_info_step3")}</li>
                  <li>{t("scan_wizard_info_step4")}</li>
                </ul>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 min-h-0 flex flex-col">
              {scanStatus === "detecting" && (
                <div className="flex items-center gap-3 px-6 py-3 bg-blue-950/30 border-b border-blue-800/40 shrink-0">
                  <div className="relative">
                    <Search className="h-5 w-5 text-blue-400" />
                    <div className="absolute -inset-1 rounded-full border border-blue-400/30 animate-ping" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-blue-300">{t("scan_wizard_scanning_title")}</p>
                    <p className="text-[10px] text-blue-500">{t("scan_wizard_scanning_sub", { dir: rootDir ?? "selected folder" })}</p>
                  </div>
                  <Loader2 className="ml-auto h-4 w-4 text-blue-400 animate-spin shrink-0" />
                </div>
              )}

              {scanStatus === "analyzing" && (
                <div className="flex items-center gap-3 px-6 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
                  <RefreshCw className="h-4 w-4 text-zinc-400 animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-zinc-300">{t("scan_wizard_analyzing_title", { done: doneCount, total: items.length })}</p>
                      <span className="text-[10px] text-zinc-500">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-red-600 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </div>
              )}

              {scanStatus === "done" && (
                <div className="flex items-center gap-3 px-6 py-3 bg-green-950/30 border-b border-green-800/40 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                  <p className="text-xs text-green-300">{t("scan_wizard_import_done", { count: doneCount })}</p>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
                {/* Multiselect toolbar */}
                {selectedScanIds.size > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800/80 border border-zinc-700 rounded-xl sticky top-0 z-10">
                    <span className="text-xs text-zinc-300 flex-1">
                      {selectedScanIds.size} selected
                    </span>
                    <button
                      onClick={handleImportSelected}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors"
                    >
                      <Download className="h-3 w-3" />
                      Import selected
                    </button>
                    <button
                      onClick={handleCancelSelected}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      Cancel selected
                    </button>
                    <button
                      onClick={clearScanSelection}
                      className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {items.length === 0 && scanStatus === "detecting" && (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 flex items-center gap-3 px-3 py-2.5">
                      <div className="w-4 h-4 bg-zinc-800 rounded animate-pulse" />
                      <div className="w-5 h-5 bg-zinc-800 rounded animate-pulse" />
                      <div className="w-9 h-9 bg-zinc-800 rounded-lg animate-pulse" />
                      <div className="flex-1 flex flex-col gap-1.5">
                        <div className="h-3 bg-zinc-800 rounded animate-pulse w-40" />
                        <div className="h-2.5 bg-zinc-800/70 rounded animate-pulse w-24" />
                      </div>
                    </div>
                  ))
                )}
                {items.map((item) => (
                  <ScannedItemRow
                    key={item.id}
                    item={item}
                    isSelected={selectedScanIds.has(item.id)}
                    onToggleSelect={toggleScanSelect}
                    onEdit={() => setEditItem(item)}
                    onRemove={removeItem}
                  />
                ))}
              </div>

              <div className="shrink-0 border-t border-zinc-800">
                <button className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 transition-colors" onClick={() => setConsoleOpen((v) => !v)}>
                  <TerminalSquare className="h-3.5 w-3.5" />
                  <span>{t("scan_wizard_console")}</span>
                  <span className="text-[10px] ml-1 text-zinc-700">{t("scan_wizard_console_events", { count: logs.length })}</span>
                  {consoleOpen ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronUp className="h-3 w-3 ml-auto" />}
                </button>

                {consoleOpen && (
                  <div className="bg-zinc-950 border-t border-zinc-800/50 px-4 py-3 max-h-36 overflow-y-auto font-mono text-[10px] text-zinc-500 space-y-0.5">
                    {logs.map((log, i) => (
                      <div key={i} className={log.includes("⚠") ? "text-amber-500" : log.includes("complete") ? "text-green-500" : ""}>
                        {log}
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 shrink-0">
            {step === 1 ? (
              <>
                <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                  {t("scan_wizard_cancel")}
                </button>
                <button onClick={startScan} disabled={!rootDir || scanTypes.size === 0} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
                  <Search className="h-4 w-4" />
                  {t("scan_wizard_start_scan")}
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col items-start gap-1 min-w-0">
                  <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                    {importPhase === "done" || importPhase === "error" ? t("scan_wizard_close") : scanStatus === "done" ? t("scan_wizard_close") : t("scan_wizard_cancel")}
                  </button>
                  {importPhase === "error" && importErrors.length > 0 && (
                    <p className="text-[10px] text-red-400 px-3">{importErrors.length} error(s) — check console</p>
                  )}
                </div>
                {scanStatus === "done" && importPhase === "idle" && (
                  <button onClick={handleImportAll} disabled={doneCount === 0} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("scan_wizard_import", { count: doneCount })}
                  </button>
                )}
                {importPhase === "importing" && (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-zinc-400">{t("scan_wizard_importing", { done: importDone, total: importDone })}</span>
                      <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div className="h-full bg-red-600 rounded-full transition-all duration-300" style={{ width: `${Math.round((importDone / (importDone || 1)) * 100)}%` }} />
                      </div>
                    </div>
                    <Loader2 className="h-4 w-4 text-red-400 animate-spin shrink-0" />
                  </div>
                )}
                {importPhase === "done" && (
                  <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("scan_wizard_import_done", { count: importDone })}
                  </div>
                )}
                {importPhase === "error" && (
                  <div className="flex items-center gap-2 text-amber-400 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    {importDone - importErrors.length}/{importDone} imported
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {editItem && (
        <ItemEditPopup item={editItem} onClose={() => setEditItem(null)} onSave={(updates) => updateItem(editItem.id, updates)} />
      )}

      {conflict && (
        <ConflictPopup conflict={conflict} onResolve={(resolution) => handleConflictResolve(resolution)} />
      )}
      {boothPickerOpen && (
        <GlobalBoothPickerModal
          title="Link Booth Product"
          subtitle="Find the Booth listing for this asset"
          onClose={() => setBoothPickerOpen(false)}
          onSelect={handleBoothSelect}
        />
      )}
      {duplicateBatch && (
        <DuplicateBatchDialog
          duplicates={duplicateBatch}
          onCancel={() => { setDuplicateBatch(null); delete (window as any).__pendingImportItems; setImportPhase("idle"); }}
          onSkipAll={() => {
            setDuplicateBatch(null);
            if ((window as any).__pendingImportItems) {
              importSpecificItems((window as any).__pendingImportItems, true, false);
              delete (window as any).__pendingImportItems;
            }
          }}
          onOverwriteAll={() => {
            setDuplicateBatch(null);
            if ((window as any).__pendingImportItems) {
              importSpecificItems((window as any).__pendingImportItems, false, true);
              delete (window as any).__pendingImportItems;
            }
          }}
        />
      )}
    </>
  );
}
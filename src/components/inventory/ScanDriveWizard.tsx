/**
 * ScanDriveWizard — Wizard de 2 pasos para escanear el disco en busca de assets de VRChat.
 *
 * Paso 1: Configuración (directorio raíz, opciones)
 * Paso 2: Escaneo + análisis en tiempo real + resolución de conflictos + import real
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, HardDrive, Search, FolderOpen, ChevronRight, Loader2,
  CheckCircle2, AlertTriangle, MoreHorizontal, Copy, Trash2,
  Layers, SkipForward, Pencil, Check, Plus, Tag, Image,
  FileText, Globe, RefreshCw, ChevronDown, ChevronUp,
  TerminalSquare, Package, Upload,
} from "lucide-react";
import { tauriGetBoothProductDetail, tauriSearchShop, tauriImportLocalPackage, ShopProduct } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { TagInput } from "./TagInput";

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
  // Populated during analysis
  name?: string;
  author?: string;
  boothId?: string;
  thumbnailUrl?: string;
  customThumbnailUrl?: string; // user-picked local or custom URL, overrides thumbnailUrl
  description?: string;
  detectedAvatars?: string[]; // avatars present in THIS download
  allAvatars?: string[];       // avatars listed on booth (the full list)
  tags?: string[];
  boothUrl?: string;
  boothFound?: boolean;
}

type ConflictResolution = "keep_copy" | "delete" | "combine" | "ignore";

interface Conflict {
  id: string;
  item1: ScannedItem;
  item2: ScannedItem;
  description: string;
}

// ── Real scan helpers ─────────────────────────────────────────────────────────

/**
 * Recursively scan a directory for VRChat asset files using the Tauri fs plugin.
 * Returns the list of matching files; aborts early if abortRef becomes true.
 */
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
        // Try to get file size
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

/**
 * Try to extract a Booth product ID from a file name.
 *
 * Booth always embeds the numeric product ID in downloaded ZIPs/packages.
 * Patterns handled (in priority order):
 *   item_1234567.zip            → trailing ID (most common)
 *   1234567_item.zip            → leading ID
 *   item_1234567_v1.2.zip       → ID surrounded by underscores
 *   item-1234567-extra.zip      → dash-separated
 *   item[1234567].zip           → ID in brackets (some Booth downloaders)
 *   item(1234567).zip           → ID in parens
 *   item 1234567 extra.zip      → space-separated
 *   anything_1234567.anything   → any 5–9 digit sequence as a word
 *
 * If multiple candidates exist, picks the longest (most specific) match.
 */
function extractBoothId(fileName: string): string | null {
  // Remove extension first
  const base = fileName.replace(/\.[^.]+$/, "");

  // All candidate digit sequences (5–9 digits) bounded by non-digit chars
  const allCandidates: string[] = [];

  // Priority 1: ID at the very end (most common Booth pattern: item_1234567)
  const trailingMatch = base.match(/[_\-\s]((\d{5,9}))$/);
  if (trailingMatch) return trailingMatch[1];

  // Priority 2: ID at the very start (1234567_item)
  const leadingMatch = base.match(/^((\d{5,9}))[_\-\s]/);
  if (leadingMatch) return leadingMatch[1];

  // Priority 3: ID in brackets or parens [1234567] or (1234567)
  const bracketMatch = base.match(/[\[\(]((\d{5,9}))[\]\)]/);
  if (bracketMatch) return bracketMatch[1];

  // Priority 4: Any 5–9 digit sequence bounded by non-digit chars
  const anyMatches = [...base.matchAll(/(?:^|[^0-9])(\d{5,9})(?:[^0-9]|$)/g)];
  for (const m of anyMatches) allCandidates.push(m[1]);

  if (allCandidates.length === 0) return null;
  // Return the longest candidate (most likely to be the real Booth ID)
  return allCandidates.sort((a, b) => b.length - a.length)[0];
}

/**
 * Clean a raw file base name into a human-readable display name.
 * e.g.  "Karin_Costume_Pink_5044411"  →  "Karin Costume Pink"
 */
function cleanDisplayName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")           // remove extension
    .replace(/(?:^|[^0-9])(\d{6,8})(?:[^0-9]|$)/g, " ") // strip booth ID
    .replace(/[_\-]+/g, " ")           // underscores/dashes → spaces
    .replace(/\s+/g, " ")              // collapse multiple spaces
    .trim();
}

/**
 * Analyze a single detected file: try a real Booth lookup and fall back to
 * local file metadata if not found.
 */
async function realAnalyze(file: DetectedFile): Promise<Partial<ScannedItem>> {
  const displayName = cleanDisplayName(file.fileName) || file.fileName;
  const boothId = extractBoothId(file.fileName);

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
        description: detail.description || undefined,
        boothFound: true,
        detectedAvatars: [],
        allAvatars: [],
        tags: [],
      };
    } catch { /* not found on Booth, fall through */ }
  }

  return {
    phase: "done",
    name: displayName,
    boothFound: false,
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
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
      included
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
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (product: ShopProduct) => void;
}) {
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
      setError(e?.message ?? "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 shrink-0">
          <Globe className="h-4 w-4 text-pink-400" />
          <span className="text-sm font-semibold text-zinc-100">Search Booth.pm</span>
          <button
            onClick={onClose}
            className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 py-3 shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-pink-500 transition-colors"
              placeholder="Search by name, author…"
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
              Search
            </button>
          </div>
          {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
          {results.length === 0 && !loading && query && (
            <p className="text-xs text-zinc-600 text-center py-6">No results found.</p>
          )}
          {results.map((product) => (
            <button
              key={product.source_id}
              onClick={() => { onSelect(product); onClose(); }}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-zinc-800 hover:border-pink-700/50 hover:bg-pink-950/20 text-left transition-all group"
            >
              {product.thumbnail_url ? (
                <img
                  src={product.thumbnail_url}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover shrink-0 bg-zinc-800"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
                  <Package className="h-5 w-5 text-zinc-600" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-200 truncate group-hover:text-pink-200">{product.name}</p>
                <p className="text-[10px] text-zinc-500 truncate">{product.author}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] text-pink-400 bg-pink-900/30 px-1.5 py-px rounded-full border border-pink-700/40">
                    #{product.source_id}
                  </span>
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
  item,
  onClose,
  onSave,
}: {
  item: ScannedItem;
  onClose: () => void;
  onSave: (updated: Partial<ScannedItem>) => void;
}) {
  const [name, setName] = useState(item.name ?? "");
  const [author, setAuthor] = useState(item.author ?? "");
  const [boothId, setBoothId] = useState(item.boothId ?? "");
  const [tags, setTags] = useState<string[]>(item.tags ?? []);
  const [newTag, setNewTag] = useState("");
  const [avatars, setAvatars] = useState<string[]>(item.detectedAvatars ?? []);
  const [newAvatar, setNewAvatar] = useState("");
  const [showBoothSearch, setShowBoothSearch] = useState(false);
  const [lookingUpBooth, setLookingUpBooth] = useState(false);

  // Thumbnail state: custom URL input or picked local file
  const effectiveThumbnail = item.customThumbnailUrl || item.thumbnailUrl;
  const [thumbnailUrl, setThumbnailUrl] = useState(item.customThumbnailUrl ?? "");
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(item.customThumbnailUrl || item.thumbnailUrl || null);
  const [thumbnailLoading, setThumbnailLoading] = useState(false);

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
          // Convert local path to a tauri-served asset URL
          const { convertFileSrc } = await import("@tauri-apps/api/core");
          const assetUrl = convertFileSrc(selected);
          setThumbnailUrl(assetUrl);
          setThumbnailPreview(assetUrl);
        } catch {
          // Fallback: use path directly
          setThumbnailUrl(selected);
          setThumbnailPreview(selected);
        }
        setThumbnailLoading(false);
      }
    } catch { /* dialog plugin not available */ }
  };

  const addTag = () => {
    const t = newTag.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setNewTag("");
  };

  const addAvatar = () => {
    const a = newAvatar.trim();
    if (a && !avatars.includes(a)) setAvatars([...avatars, a]);
    setNewAvatar("");
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Edit detected item</h3>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* File info */}
          <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-2">
            <Package className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono">{item.fileName}</span>
            <ExtBadge ext={item.ext} />
          </div>

          {/* Thumbnail */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
              <Image className="h-3 w-3" /> Thumbnail
            </label>
            <div className="flex gap-3 items-start">
              {/* Preview */}
              <div className="shrink-0 w-20 h-20 rounded-xl bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center">
                {thumbnailLoading ? (
                  <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
                ) : thumbnailPreview ? (
                  <img
                    src={thumbnailPreview}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={() => setThumbnailPreview(null)}
                  />
                ) : (
                  <Package className="h-6 w-6 text-zinc-600" />
                )}
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-red-500 transition-colors"
                  placeholder="Paste image URL…"
                  value={thumbnailUrl}
                  onChange={(e) => {
                    setThumbnailUrl(e.target.value);
                    setThumbnailPreview(e.target.value || null);
                  }}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={pickLocalThumbnail}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                  >
                    <Upload className="h-3 w-3" />
                    Pick file…
                  </button>
                  {thumbnailPreview && (
                    <button
                      onClick={() => { setThumbnailUrl(""); setThumbnailPreview(null); }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-900/40 border border-zinc-700 hover:border-red-700/50 text-zinc-500 hover:text-red-400 text-xs transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Clear
                    </button>
                  )}
                </div>
                {item.thumbnailUrl && thumbnailUrl !== item.thumbnailUrl && (
                  <button
                    onClick={() => { setThumbnailUrl(item.thumbnailUrl!); setThumbnailPreview(item.thumbnailUrl!); }}
                    className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    ↺ Restore Booth thumbnail
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">Name</label>
            <input
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-red-500 transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Author */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">Author</label>
            <input
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-red-500 transition-colors"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>

          {/* Booth ID */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
              <Globe className="h-3 w-3" /> Booth ID
              {!item.boothFound && (
                <span className="text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-px rounded-full border border-amber-700/50">
                  Not found automatically
                </span>
              )}
            </label>
            <div className="flex gap-1.5">
              <input
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-red-500 transition-colors font-mono"
                placeholder="e.g. 6082686"
                value={boothId}
                onChange={(e) => setBoothId(e.target.value)}
              />
              {/* Manual lookup by ID */}
              <button
                title="Fetch from Booth by ID"
                disabled={!boothId.trim() || lookingUpBooth}
                onClick={async () => {
                  if (!boothId.trim()) return;
                  setLookingUpBooth(true);
                  try {
                    const detail = await tauriGetBoothProductDetail(boothId.trim());
                    if (detail.name) setName(detail.name);
                    if (detail.author) setAuthor(detail.author);
                    if (detail.images?.[0] && !thumbnailUrl) {
                      setThumbnailUrl(detail.images[0]);
                      setThumbnailPreview(detail.images[0]);
                    }
                  } catch { /* not found */ }
                  setLookingUpBooth(false);
                }}
                className="px-2.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
              >
                {lookingUpBooth ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </button>
              {/* Search Booth popup */}
              <button
                title="Search Booth.pm"
                onClick={() => setShowBoothSearch(true)}
                className="px-2.5 py-2 rounded-lg bg-pink-900/40 hover:bg-pink-900/60 border border-pink-700/50 text-pink-400 hover:text-pink-200 transition-colors text-xs font-medium flex items-center gap-1"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            </div>
            {boothId && (
              <a
                href={`https://booth.pm/en/items/${boothId}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-pink-500 hover:text-pink-300 transition-colors"
              >
                booth.pm/en/items/{boothId} ↗
              </a>
            )}
          </div>

          {/* Detected avatars */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium">Avatars included in this download</label>
            <div className="flex flex-wrap gap-1.5 min-h-[28px]">
              {avatars.map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatars(avatars.filter((x) => x !== a))}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-green-900/40 text-green-300 border border-green-700/50 hover:bg-red-900/40 hover:text-red-300 hover:border-red-700/50 transition-colors group"
                >
                  {a}
                  <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
              {item.allAvatars?.filter((a) => !avatars.includes(a)).map((a) => (
                <button
                  key={a}
                  onClick={() => setAvatars([...avatars, a])}
                  className="text-[10px] px-2 py-0.5 rounded-full text-zinc-500 border border-dashed border-zinc-700 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  + {a}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-red-500 transition-colors"
                placeholder="Add avatar name…"
                value={newAvatar}
                onChange={(e) => setNewAvatar(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addAvatar()}
              />
              <button
                onClick={addAvatar}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-400 font-medium flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</label>
            <TagInput tags={tags} onChange={setTags} placeholder="Add tag…" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800 sticky bottom-0 bg-zinc-900">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Cancel
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
              });
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
          >
            Save changes
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
          if (product.thumbnail_url && !thumbnailUrl) {
            setThumbnailUrl(product.thumbnail_url);
            setThumbnailPreview(product.thumbnail_url);
          }
        }}
      />
    )}
    </>
  );
}

// ── Conflict Popup ────────────────────────────────────────────────────────────

function ConflictPopup({
  conflict,
  onResolve,
}: {
  conflict: Conflict;
  onResolve: (resolution: ConflictResolution, conflictId: string) => void;
}) {
  const OPTIONS: { id: ConflictResolution; icon: React.ReactNode; label: string; desc: string; danger?: boolean }[] = [
    { id: "keep_copy", icon: <Copy className="h-4 w-4" />, label: "Keep as copy", desc: "Save both items separately in your inventory" },
    { id: "combine",   icon: <Layers className="h-4 w-4" />, label: "Try to combine", desc: "Merge avatar coverage from both packages into one entry" },
    { id: "delete",    icon: <Trash2 className="h-4 w-4" />, label: "Delete selected", desc: "Remove the second item and keep only the first", danger: true },
    { id: "ignore",    icon: <SkipForward className="h-4 w-4" />, label: "Ignore for now", desc: "Skip this conflict — you can resolve it later from the inventory" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-amber-800/60 rounded-2xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-zinc-800">
          <div className="h-8 w-8 rounded-lg bg-amber-900/50 border border-amber-700/60 flex items-center justify-center shrink-0">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Conflict detected</h3>
            <p className="text-xs text-zinc-500">{conflict.description}</p>
          </div>
        </div>

        {/* Side-by-side preview */}
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          {[conflict.item1, conflict.item2].map((item, i) => (
            <div key={i} className="bg-zinc-800/60 rounded-xl border border-zinc-700 p-3 flex flex-col gap-2">
              {item.thumbnailUrl && (
                <img src={item.thumbnailUrl} alt="" className="w-full aspect-video object-cover rounded-lg" />
              )}
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

        {/* Resolution options */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          {OPTIONS.map(({ id, icon, label, desc, danger }) => (
            <button
              key={id}
              onClick={() => onResolve(id, conflict.id)}
              className={`flex flex-col gap-1.5 p-3 rounded-xl border text-left transition-all hover:scale-[1.02] ${
                danger
                  ? "bg-red-950/30 border-red-800/50 hover:bg-red-950/60 hover:border-red-700"
                  : "bg-zinc-800/50 border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600"
              }`}
            >
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

// ── Scanned Item Row ──────────────────────────────────────────────────────────

function ScannedItemRow({
  item,
  onEdit,
}: {
  item: ScannedItem;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border transition-all ${
      item.phase === "conflict"
        ? "border-amber-700/60 bg-amber-950/20"
        : item.phase === "done"
        ? "border-zinc-800 bg-zinc-900/50"
        : "border-zinc-800/50 bg-zinc-900/30"
    }`}>
      {/* Main row */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Status icon */}
        <div className="shrink-0 w-5 flex items-center justify-center">
          {item.phase === "detecting" && <Loader2 className="h-3.5 w-3.5 text-zinc-500 animate-spin" />}
          {item.phase === "indexing"  && <Search className="h-3.5 w-3.5 text-blue-400 animate-pulse" />}
          {item.phase === "done"      && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
          {item.phase === "conflict"  && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
        </div>

        {/* Thumbnail */}
        <div className="shrink-0 w-9 h-9 rounded-lg bg-zinc-800 overflow-hidden">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : item.phase === "indexing" ? (
            <div className="w-full h-full bg-zinc-700 animate-pulse" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="h-4 w-4 text-zinc-600" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
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
                {!item.boothFound && item.phase === "done" && (
                  <span className="text-[9px] text-zinc-600 bg-zinc-800 px-1.5 py-px rounded-full border border-zinc-700">Not on Booth</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ExtBadge ext={item.ext} />
          <span className="text-[10px] text-zinc-600">{item.sizeMb}MB</span>

          {/* Avatar count badge */}
          {item.phase === "done" && item.detectedAvatars && item.allAvatars && (
            <span className={`text-[9px] px-1.5 py-px rounded-full border ${
              item.detectedAvatars.length < item.allAvatars.length
                ? "text-amber-300 bg-amber-900/30 border-amber-700/50"
                : "text-green-300 bg-green-900/30 border-green-700/50"
            }`}>
              {item.detectedAvatars.length}/{item.allAvatars.length} avatars
            </span>
          )}

          {/* Expand */}
          {item.phase === "done" && (
            <button
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}

          {/* Edit */}
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors"
            onClick={onEdit}
            title="Edit details"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && item.phase === "done" && (
        <div className="px-3 pb-3 border-t border-zinc-800/50 pt-2.5 flex flex-col gap-2">
          {/* Avatars */}
          {item.allAvatars && item.allAvatars.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-zinc-500 font-medium">Avatar coverage</p>
              <div className="flex flex-wrap gap-1">
                {item.allAvatars.map((a) => (
                  <AvatarPill key={a} name={a} included={item.detectedAvatars?.includes(a) ?? false} />
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {item.description && (
            <p className="text-[10px] text-zinc-500 leading-relaxed line-clamp-2">{item.description}</p>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.tags.map((t) => (
                <span key={t} className="text-[9px] px-1.5 py-px rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">{t}</span>
              ))}
            </div>
          )}

          {/* File path */}
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
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 config
  const [rootDir, setRootDir] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [scanTypes, setScanTypes] = useState<Set<string>>(new Set(["unitypackage", "zip", "fbx", "vrm", "glb"]));

  // Step 2 state
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
  const { fetchAll } = useInventoryStore();

  const addLog = useCallback((msg: string) => {
    setLogs((l) => [...l, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const toggleScanType = (t: string) => {
    setScanTypes((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const startScan = async () => {
    setStep(2);
    setScanStatus("detecting");
    scanAbortRef.current = false;
    setItems([]);
    setDetectedFiles([]);
    setLogs([]);
    setProgress(0);

    if (!rootDir) {
      setScanStatus("error");
      return;
    }

    addLog(`Starting scan in: ${rootDir}`);
    addLog(`Options: recursive=${recursive}, types=[${[...scanTypes].join(",")}]`);

    // Phase 1: Detect files on the real filesystem
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
      addLog("No matching files found in the selected directory.");
      setScanStatus("done");
      return;
    }

    addLog(`Found ${detected.length} candidate files`);
    setDetectedFiles(detected);

    // Populate items as "detecting"
    const initial: ScannedItem[] = detected.map((f) => ({ ...f, phase: "detecting" }));
    setItems(initial);

    setScanStatus("analyzing");
    addLog("Beginning deep analysis…");

    // Phase 2: Analyze each file with real Booth lookup
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
  };

  const handleConflictResolve = (resolution: ConflictResolution) => {
    addLog(`Conflict resolved: ${resolution}`);
    setConflict(null);
    (window as any).__conflictResolve?.();
  };

  const updateItem = (id: string, updates: Partial<ScannedItem>) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...updates } : it));
  };

  const importAll = async () => {
    const readyItems = items.filter((i) => i.phase === "done");
    if (readyItems.length === 0) return;
    setImportPhase("importing");
    setImportDone(0);
    setImportErrors([]);
    const errors: string[] = [];
    for (let i = 0; i < readyItems.length; i++) {
      const item = readyItems[i];
      try {
        await tauriImportLocalPackage({
          zip_path: item.filePath,
          name: item.name ?? item.fileName,
          author: item.author ?? undefined,
          thumbnail_url: item.customThumbnailUrl ?? item.thumbnailUrl ?? undefined,
          booth_id: item.boothId ?? undefined,
        });
        addLog(`✓ Imported: ${item.name ?? item.fileName}`);
      } catch (e: any) {
        const msg = `✗ Failed: ${item.fileName} — ${e?.message ?? String(e)}`;
        errors.push(msg);
        addLog(msg);
      }
      setImportDone(i + 1);
    }
    setImportErrors(errors);
    setImportPhase(errors.length > 0 ? "error" : "done");
    // Refresh inventory store once after all imports
    await fetchAll();
    onComplete?.(readyItems.length - errors.length);
  };

  const doneCount = items.filter((i) => i.phase === "done").length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col" style={{ maxHeight: "90vh" }}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center">
                <HardDrive className="h-4.5 w-4.5 text-red-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Scan Drive</h2>
                <p className="text-[11px] text-zinc-500">
                  {step === 1 ? "Configure scan options" : scanStatus === "done" ? `${doneCount} items analyzed` : "Scanning your drive for VRChat assets…"}
                </p>
              </div>
            </div>

            {/* Step pills */}
            <div className="flex items-center gap-2">
              {[1, 2].map((s) => (
                <div key={s} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                  step === s
                    ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                    : s < step
                    ? "bg-green-900/40 border-green-700/50 text-green-400"
                    : "bg-zinc-900 border-zinc-800 text-zinc-600"
                }`}>
                  {s < step ? <CheckCircle2 className="h-3 w-3" /> : <span className="w-3 h-3 flex items-center justify-center text-[10px] font-mono">{s}</span>}
                  <span>{s === 1 ? "Configure" : "Scan"}</span>
                </div>
              ))}
              <button
                onClick={onClose}
                className="ml-2 h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Step 1: Config ───────────────────────────────────────────── */}
          {step === 1 && (
            <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
              {/* Root directory */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-300">Root directory to scan</label>
                <p className="text-[11px] text-zinc-500">
                  Use the Browse button to select a folder. This is required — Tauri needs OS-granted
                  access to read directory contents.
                </p>
                <div className="flex gap-2">
                  {/* Read-only display */}
                  <div className={`flex-1 flex items-center gap-2 bg-zinc-800 border rounded-lg px-3 py-2 text-sm transition-colors ${
                    rootDir ? "border-zinc-700 text-zinc-200" : "border-dashed border-zinc-600 text-zinc-600"
                  }`}>
                    {rootDir ? (
                      <span className="truncate font-mono text-xs">{rootDir}</span>
                    ) : (
                      <span className="text-xs italic">No folder selected — click Browse</span>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const { open } = await import("@tauri-apps/plugin-dialog");
                        const selected = await open({ directory: true, multiple: false });
                        if (typeof selected === "string") setRootDir(selected);
                      } catch {
                        // plugin-dialog not available in dev mode
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 border border-zinc-600 text-zinc-200 text-xs font-medium transition-colors whitespace-nowrap"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Browse…
                  </button>
                </div>
                {rootDir && (
                  <button
                    onClick={() => setRootDir(null)}
                    className="self-start text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    × Clear selection
                  </button>
                )}
              </div>

              {/* Recursive */}
              <div className="flex items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-zinc-200">Scan subdirectories</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Recursively search all nested folders</p>
                </div>
                <button
                  onClick={() => setRecursive((v) => !v)}
                  className={`relative h-5 w-9 rounded-full border transition-all ${recursive ? "bg-red-600 border-red-700" : "bg-zinc-700 border-zinc-600"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all shadow ${recursive ? "left-4" : "left-0.5"}`} />
                </button>
              </div>

              {/* File types */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-300">File types to scan</label>
                <div className="flex flex-wrap gap-2">
                  {(["unitypackage", "zip", "fbx", "vrm", "glb"] as const).map((ext) => (
                    <button
                      key={ext}
                      onClick={() => toggleScanType(ext)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-all ${
                        scanTypes.has(ext)
                          ? "bg-red-900/40 border-red-700 text-red-300"
                          : "bg-zinc-800 border-zinc-700 text-zinc-500"
                      }`}
                    >
                      {scanTypes.has(ext) && <Check className="h-3 w-3" />}
                      .{ext}
                    </button>
                  ))}
                </div>
              </div>

              {/* Info box */}
              <div className="rounded-xl bg-blue-950/30 border border-blue-800/50 px-4 py-3 flex flex-col gap-1">
                <p className="text-xs font-medium text-blue-300 flex items-center gap-1.5"><Search className="h-3.5 w-3.5" /> How it works</p>
                <ul className="text-[11px] text-blue-400/80 space-y-1 list-disc list-inside leading-relaxed">
                  <li>First, all matching files are detected and marked as suspicious</li>
                  <li>Each file is analyzed to identify avatar bases, outfits and accessories</li>
                  <li>Booth.pm is queried to fetch product details, images and descriptions</li>
                  <li>Conflicts (duplicates, overlapping coverage) are flagged for your review</li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Step 2: Scanning ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="flex-1 min-h-0 flex flex-col">
              {/* Phase banner */}
              {scanStatus === "detecting" && (
                <div className="flex items-center gap-3 px-6 py-3 bg-blue-950/30 border-b border-blue-800/40 shrink-0">
                  <div className="relative">
                    <Search className="h-5 w-5 text-blue-400" />
                    <div className="absolute -inset-1 rounded-full border border-blue-400/30 animate-ping" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-blue-300">Scanning your drive…</p>
                    <p className="text-[10px] text-blue-500">Looking for VRChat assets in {rootDir ?? "selected folder"}</p>
                  </div>
                  <Loader2 className="ml-auto h-4 w-4 text-blue-400 animate-spin shrink-0" />
                </div>
              )}

              {scanStatus === "analyzing" && (
                <div className="flex items-center gap-3 px-6 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
                  <RefreshCw className="h-4 w-4 text-zinc-400 animate-spin shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-zinc-300">Analyzing {doneCount}/{items.length} items</p>
                      <span className="text-[10px] text-zinc-500">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-600 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {scanStatus === "done" && (
                <div className="flex items-center gap-3 px-6 py-3 bg-green-950/30 border-b border-green-800/40 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-green-300">Scan complete</p>
                    <p className="text-[10px] text-green-600">{doneCount} items ready to import into your inventory</p>
                  </div>
                </div>
              )}

              {/* Item list */}
              <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
                {items.length === 0 && scanStatus === "detecting" && (
                  <>
                    {/* Skeleton */}
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="rounded-xl border border-zinc-800/50 bg-zinc-900/30 flex items-center gap-3 px-3 py-2.5">
                        <div className="w-5 h-5 bg-zinc-800 rounded animate-pulse" />
                        <div className="w-9 h-9 bg-zinc-800 rounded-lg animate-pulse" />
                        <div className="flex-1 flex flex-col gap-1.5">
                          <div className="h-3 bg-zinc-800 rounded animate-pulse w-40" />
                          <div className="h-2.5 bg-zinc-800/70 rounded animate-pulse w-24" />
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {items.map((item) => (
                  <ScannedItemRow
                    key={item.id}
                    item={item}
                    onEdit={() => setEditItem(item)}
                  />
                ))}
              </div>

              {/* Console */}
              <div className="shrink-0 border-t border-zinc-800">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 transition-colors"
                  onClick={() => setConsoleOpen((v) => !v)}
                >
                  <TerminalSquare className="h-3.5 w-3.5" />
                  <span>Console</span>
                  <span className="text-[10px] ml-1 text-zinc-700">{logs.length} events</span>
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

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 shrink-0">
            {step === 1 ? (
              <>
                <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={startScan}
                  disabled={!rootDir || scanTypes.size === 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  <Search className="h-4 w-4" />
                  Start Scan
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col items-start gap-1 min-w-0">
                  <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
                    {importPhase === "done" || importPhase === "error" ? "Close" : scanStatus === "done" ? "Close" : "Cancel"}
                  </button>
                  {importPhase === "error" && importErrors.length > 0 && (
                    <p className="text-[10px] text-red-400 px-3">{importErrors.length} error(s) — check console</p>
                  )}
                </div>
                {scanStatus === "done" && importPhase === "idle" && (
                  <button
                    onClick={importAll}
                    disabled={doneCount === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Import {doneCount} items
                  </button>
                )}
                {importPhase === "importing" && (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-zinc-400">Importing {importDone}/{doneCount}…</span>
                      <div className="w-32 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-600 rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((importDone / doneCount) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <Loader2 className="h-4 w-4 text-red-400 animate-spin shrink-0" />
                  </div>
                )}
                {importPhase === "done" && (
                  <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4" />
                    {importDone} items imported!
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

      {/* Overlays */}
      {editItem && (
        <ItemEditPopup
          item={editItem}
          onClose={() => setEditItem(null)}
          onSave={(updates) => updateItem(editItem.id, updates)}
        />
      )}

      {conflict && (
        <ConflictPopup
          conflict={conflict}
          onResolve={(resolution) => handleConflictResolve(resolution)}
        />
      )}
    </>
  );
}
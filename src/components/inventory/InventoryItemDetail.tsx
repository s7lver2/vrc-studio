import {
  X, ExternalLink, Trash2, FolderInput, FolderOpen,
  Info, FileArchive, Box, ChevronLeft, ChevronRight,
  Calendar, HardDrive, User, Link, Tag, Loader2,
  AlertTriangle, Package, Archive, Download, Star,
  FileText, Layers, Clock,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useInventoryStore } from "../../store/inventoryStore";
import { FileTreeViewer } from "./FileTreeViewver";
import { FileIcon, ExtBadge } from "./FileIcon";
import { Preview3D } from "./Preview3D";
import {
  InventoryItem, InventoryFolder, FileNode, UnityAsset,
  BoothProductDetail, DeleteMode,
  tauriGetFileTree, tauriOpenItemLocation, tauriReadUnitypackage,
  tauriGetItemProductImages, tauriGetBoothProductDetail,
} from "../../lib/tauri";
import { useT } from "@/i18n";

// ── helpers ───────────────────────────────────────────────────────────────────

function formatBytes(b: number | null): string {
  if (b == null) return "Unknown";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  } catch { return iso; }
}

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const d = Math.floor(ms / 86400000);
    if (d === 0) return "Today";
    if (d === 1) return "Yesterday";
    if (d < 30) return `${d} days ago`;
    if (d < 365) return `${Math.floor(d / 30)} months ago`;
    return `${Math.floor(d / 365)} years ago`;
  } catch { return ""; }
}

const SOURCE_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  booth:       { label: "Booth.pm",    color: "bg-pink-900/40 text-pink-300 border-pink-700/50",     dot: "bg-pink-400" },
  riperstore:  { label: "Riperstore",  color: "bg-purple-900/40 text-purple-300 border-purple-700/50", dot: "bg-purple-400" },
  local:       { label: "Local",       color: "bg-zinc-700/40 text-zinc-300 border-zinc-600/50",     dot: "bg-zinc-400" },
};

// ── Image gallery ─────────────────────────────────────────────────────────────

function ImageGallery({ images, fallback }: { images: string[]; fallback: string | null }) {
  const t = useT();
  const all = images.length > 0 ? images : (fallback ? [fallback] : []);
  const [idx, setIdx] = useState(0);
  const [errored, setErrored] = useState<Set<number>>(new Set());

  if (all.length === 0) {
    return (
      <div className="w-full aspect-video bg-zinc-900 rounded-xl flex flex-col items-center justify-center gap-2 text-zinc-700 border border-zinc-800">
        <FileArchive className="h-10 w-10" />
        <span className="text-xs">{t("inventory_detail_no_images")}</span>
      </div>
    );
  }

  const safeIdx = Math.min(idx, all.length - 1);
  const current = all[safeIdx];

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full bg-zinc-950 rounded-xl overflow-hidden group" style={{ aspectRatio: "16/9" }}>
        {current && !errored.has(safeIdx) ? (
          <img src={current} alt="" className="w-full h-full object-contain" onError={() => setErrored((s) => new Set([...s, safeIdx]))} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">t("inventory_detail_image_unavailable")</div>
        )}
        {all.length > 1 && (
          <>
            <button className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setIdx((i) => (i - 1 + all.length) % all.length)}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setIdx((i) => (i + 1) % all.length)}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 right-2 text-[10px] bg-black/60 text-white rounded px-1.5 py-0.5">{safeIdx + 1} / {all.length}</div>
          </>
        )}
      </div>
      {all.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {all.map((src, i) => (
            <button key={i} className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${i === safeIdx ? "border-red-500 scale-105" : "border-zinc-800 hover:border-zinc-600"}`} onClick={() => setIdx(i)}>
              {!errored.has(i) ? (
                <img src={src} alt="" className="w-full h-full object-cover" onError={() => setErrored((s) => new Set([...s, i]))} />
              ) : (
                <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                  <AlertTriangle className="h-3 w-3 text-zinc-600" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Unity tree ────────────────────────────────────────────────────────────────

interface UnityTreeNode {
  name: string; path: string; isDir: boolean;
  children: UnityTreeNode[]; asset?: UnityAsset;
}

function buildUnityTree(assets: UnityAsset[]): UnityTreeNode {
  const root: UnityTreeNode = { name: "Assets", path: "Assets", isDir: true, children: [] };
  for (const asset of assets) {
    const parts = asset.asset_path.replace(/^Assets\//, "").split("/");
    let node = root;
    let currentPath = "Assets";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = `${currentPath}/${part}`;
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path: currentPath, isDir: !isLast, children: [], asset: isLast ? asset : undefined };
        node.children.push(child);
      }
      if (!isLast) node = child;
    }
  }
  return root;
}

function getExt(name: string): string | null {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : null;
}

function UnityTreeRow({ node, depth }: { node: UnityTreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const ext = getExt(node.name);

  if (node.isDir) {
    return (
      <div>
        <button className="flex items-center gap-1.5 w-full text-left hover:bg-zinc-800/60 rounded px-1 py-0.5" style={{ paddingLeft: `${depth * 16 + 4}px` }} onClick={() => setOpen((v) => !v)}>
          <span className="text-zinc-600 shrink-0">{open ? <ChevronLeft className="h-3 w-3 rotate-90" /> : <ChevronRight className="h-3 w-3" />}</span>
          <FileIcon ext={null} isDir size={13} open={open} />
          <span className="text-xs text-zinc-200 truncate ml-0.5">{node.name}</span>
          <span className="text-[10px] text-zinc-600 ml-auto shrink-0 pr-1">{node.children.length}</span>
        </button>
        {open && <div>{node.children.map((c, i) => <UnityTreeRow key={i} node={c} depth={depth + 1} />)}</div>}
      </div>
    );
  }

  const sizeStr = node.asset?.size
    ? node.asset.size < 1024 ? `${node.asset.size} B`
    : node.asset.size < 1024 ** 2 ? `${(node.asset.size / 1024).toFixed(1)} KB`
    : `${(node.asset.size / 1024 ** 2).toFixed(1)} MB`
    : null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5 hover:bg-zinc-800/40 rounded group" style={{ paddingLeft: `${depth * 16 + 4}px` }}>
      <span className="w-3 shrink-0" />
      <FileIcon ext={ext} size={13} />
      <span className="text-xs truncate ml-0.5 flex-1 text-zinc-300">{node.name}</span>
      <div className="flex items-center gap-1 ml-auto shrink-0 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {ext && <ExtBadge ext={ext} />}
        {sizeStr && <span className="text-[10px] text-zinc-500 tabular-nums">{sizeStr}</span>}
      </div>
      {!node.asset?.has_asset_file && <span className="text-[9px] text-zinc-700 shrink-0">meta</span>}
    </div>
  );
}

function UnityPackageViewer({ path }: { path: string }) {
  const t = useT();
  const [assets, setAssets] = useState<UnityAsset[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "flat">("tree");

  useEffect(() => {
    setLoading(true);
    tauriReadUnitypackage(path)
      .then(setAssets)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [path]);

  if (loading) return <div className="flex items-center gap-2 text-zinc-500 text-xs py-3 pl-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("file_viewer_reading")}</div>;
  if (error) return <p className="text-red-400 text-xs py-2 pl-2">{error}</p>;
  if (!assets || assets.length === 0) return <p className="text-zinc-600 text-xs py-2 pl-2">{t("file_viewer_empty_package")}</p>;

  const tree = buildUnityTree(assets);
  const fileName = path.split(/[\\/]/).pop() ?? path;

  // Count by extension
  const extCounts: Record<string, number> = {};
  for (const a of assets) {
    const ext = getExt(a.asset_path) ?? "other";
    extCounts[ext] = (extCounts[ext] ?? 0) + 1;
  }
  const topExts = Object.entries(extCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-xs font-semibold text-blue-300 truncate max-w-[220px]">{fileName}</span>
          <span className="text-[10px] text-zinc-600">({assets.length} assets)</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setView("tree")} className={`text-[10px] px-2 py-0.5 rounded transition-colors ${view === "tree" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}>{t("file_viewer_tree")}</button>
          <button onClick={() => setView("flat")} className={`text-[10px] px-2 py-0.5 rounded transition-colors ${view === "flat" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"}`}>{t("file_viewer_flat")}</button>
        </div>
      </div>

      {/* Extension breakdown */}
      <div className="flex gap-1.5 flex-wrap">
        {topExts.map(([ext, count]) => (
          <div key={ext} className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5">
            <FileIcon ext={ext} size={11} />
            <span className="text-[10px] text-zinc-400">.{ext}</span>
            <span className="text-[10px] text-zinc-600 tabular-nums">{count}</span>
          </div>
        ))}
      </div>

      <div className="bg-zinc-900/60 rounded-lg border border-zinc-800 overflow-auto max-h-64 p-1">
        {view === "tree" ? (
          <UnityTreeRow node={tree} depth={0} />
        ) : (
          assets.map((a, i) => {
            const ext = getExt(a.asset_path);
            return (
              <div key={i} className="flex items-center gap-2 px-2 py-0.5 hover:bg-zinc-800/60 rounded group">
                <span className="text-[10px] font-mono text-zinc-700 shrink-0 w-16 truncate">{a.guid.slice(0, 8)}</span>
                <FileIcon ext={ext} size={12} />
                <span className="text-xs truncate flex-1 text-zinc-300">{a.asset_path}</span>
                {a.size != null && (
                  <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums opacity-0 group-hover:opacity-100">
                    {a.size < 1024 ** 2 ? `${(a.size / 1024).toFixed(0)} KB` : `${(a.size / 1024 ** 2).toFixed(1)} MB`}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Action menus ──────────────────────────────────────────────────────────────

function DeleteMenu({ item, onDeleted }: { item: InventoryItem; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const { removeItem } = useInventoryStore();
  const del = async (mode: DeleteMode) => { await removeItem(item.id, mode); setOpen(false); onDeleted(); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 border border-red-800/50 text-red-400 text-xs transition-colors">
        <Trash2 className="h-3.5 w-3.5" /> {t("inventory_detail_actions_delete")}
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 right-0 z-10 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1.5 w-58 text-xs overflow-hidden">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider px-3 pb-1">{t("inventory_detail_delete_scope_title")}</p>
          <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-zinc-300 hover:bg-zinc-800" onClick={() => del("InventoryOnly")}><Trash2 className="h-3.5 w-3.5 text-zinc-500" /> {t("inventory_detail_delete_inventory_only")}</button>
          <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-orange-300 hover:bg-zinc-800" onClick={() => del("InventoryAndDisk")}><HardDrive className="h-3.5 w-3.5" /> {t("inventory_detail_delete_disk_too")}</button>
          <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-400 hover:bg-zinc-800" onClick={() => del("InventoryDiskAndProjects")}><Trash2 className="h-3.5 w-3.5" /> {t("inventory_detail_delete_everywhere")}</button>
        </div>
      )}
    </div>
  );
}

function MoveMenu({ item, folders }: { item: InventoryItem; folders: InventoryFolder[] }) {
  const [open, setOpen] = useState(false);
  const { moveItem } = useInventoryStore();
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 text-xs transition-colors">
        <FolderInput className="h-3.5 w-3.5" /> {t("inventory_detail_move_menu")}
      </button>
      {open && folders.length > 0 && (
        <div className="absolute bottom-full mb-1 left-0 z-10 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 w-48 text-xs max-h-48 overflow-y-auto">
          {folders.map((f) => (
            <button key={f.id} className="w-full flex items-center gap-2 px-3 py-2 text-left text-zinc-300 hover:bg-zinc-800" onClick={async () => { await moveItem(item.id, f.id); setOpen(false); }}>
              <FileIcon ext={null} isDir size={12} /> {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tree scanning helpers ────────────────────────────────────────────────────

function findUnityPackages(node: FileNode, found: string[] = []): string[] {
  if (!node.is_dir && node.extension?.toLowerCase() === "unitypackage") found.push(node.path);
  for (const child of node.children ?? []) findUnityPackages(child, found);
  return found;
}

function find3DFiles(node: FileNode, found: string[] = []): string[] {
  const ext3d = new Set(["fbx", "vrm", "glb", "gltf", "obj"]);
  if (!node.is_dir && node.extension && ext3d.has(node.extension.toLowerCase())) found.push(node.path);
  for (const child of node.children ?? []) find3DFiles(child, found);
  return found;
}

function countFiles(node: FileNode): number {
  if (!node.is_dir) return 1;
  return (node.children ?? []).reduce((acc, c) => acc + countFiles(c), 0);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "overview" | "files" | "3d";

// ── Stat pill ────────────────────────────────────────────────────────────────

function StatPill({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex-1 min-w-0">
      <div className="flex items-center gap-1.5 text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <span className="text-sm font-semibold text-zinc-200 truncate">{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function InventoryItemDetail({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const t = useT();
  const { folders, items } = useInventoryStore();
  const [tab, setTab] = useState<Tab>("overview");

  const [boothDetail, setBoothDetail] = useState<BoothProductDetail | null>(null);
  const [boothLoading, setBoothLoading] = useState(false);
  const [productImages, setProductImages] = useState<string[]>([]);

  const [fileTree, setFileTree] = useState<FileNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [unityPackagePaths, setUnityPackagePaths] = useState<string[]>([]);
  const [model3DPaths, setModel3DPaths] = useState<string[]>([]);
  const [selectedUnityPkg, setSelectedUnityPkg] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);

  useEffect(() => {
    tauriGetItemProductImages(item.id).then(setProductImages);
    if (item.source === "booth" && item.source_id) {
      setBoothLoading(true);
      tauriGetBoothProductDetail(item.source_id)
        .then(setBoothDetail).catch(() => {}).finally(() => setBoothLoading(false));
    }
  }, [item.id, item.source, item.source_id]);

  const loadTree = useCallback(() => {
    if (fileTree || treeLoading) return;
    setTreeLoading(true);
    tauriGetFileTree(item.local_path)
      .then((tree) => {
        setFileTree(tree);
        setUnityPackagePaths(findUnityPackages(tree));
        setModel3DPaths(find3DFiles(tree));
        setFileCount(countFiles(tree));
      })
      .catch(() => {}).finally(() => setTreeLoading(false));
  }, [item.local_path, fileTree, treeLoading]);

  useEffect(() => {
    if (tab === "files" || tab === "3d") loadTree();
  }, [tab, loadTree]);

  const allImages = boothDetail?.images.length ? boothDetail.images : productImages;
  const src = SOURCE_LABELS[item.source] ?? SOURCE_LABELS.local;
  const boothUrl = item.source === "booth" && item.source_id
    ? `https://booth.pm/items/${item.source_id}`
    : boothDetail?.url ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" onClick={onClose} />

      {/* Modal — wide, tall */}
      <div className="relative z-10 w-full max-w-5xl max-h-[92vh] bg-zinc-950 border border-zinc-800/80 rounded-2xl shadow-[0_32px_80px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-start gap-4 px-6 pt-5 pb-4 border-b border-zinc-800/80 shrink-0 bg-zinc-950">
          {item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt="" className="w-16 h-16 rounded-xl object-cover shrink-0 bg-zinc-800 ring-1 ring-zinc-700" />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-zinc-800 shrink-0 flex items-center justify-center ring-1 ring-zinc-700">
              <Package className="h-7 w-7 text-zinc-600" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-zinc-100 leading-tight pr-8 truncate">{item.name}</h2>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${src.color}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${src.dot}`} />
                {src.label}
              </span>
              {item.author && (
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <User className="h-3 w-3" /> {item.author}
                </span>
              )}
              {item.source_id && (
                <span className="text-[10px] text-zinc-600 font-mono">#{item.source_id}</span>
              )}
              {item.tags.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {item.tags.slice(0, 4).map((t) => (
                    <span key={t} className="text-[10px] bg-zinc-800 text-zinc-500 rounded-full px-1.5 py-px">{t}</span>
                  ))}
                  {item.tags.length > 4 && <span className="text-[10px] text-zinc-600">+{item.tags.length - 4}</span>}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors shrink-0 mt-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 px-6 border-b border-zinc-800/80 shrink-0 bg-zinc-950">
          {([
            { id: "overview", label: t("inventory_detail_tab_overview"), icon: Info },
            { id: "files",    label: t("inventory_detail_tab_files"),    icon: FileArchive },
            { id: "3d",       label: t("inventory_detail_tab_3d"), icon: Box, beta: true },
          ] as { id: Tab; label: string; icon: React.ElementType; beta?: boolean }[]).map(({ id, label, icon: Icon, beta }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 pb-3 pt-3 text-xs font-medium border-b-2 transition-colors ${
                tab === id ? "border-red-500 text-red-400" : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {beta && <span className="text-[9px] bg-amber-900/50 text-amber-400 border border-amber-800/60 rounded-full px-1 py-px">{t("inventory_detail_beta")}</span>}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ── OVERVIEW: two-column layout ── */}
          {tab === "overview" && (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] h-full divide-y md:divide-y-0 md:divide-x divide-zinc-800/60">

              {/* LEFT: Gallery + tags + actions */}
              <div className="p-6 flex flex-col gap-5 overflow-y-auto">
                <ImageGallery images={allImages} fallback={item.thumbnail_url} />

                {/* Quick stats row */}
                <div className="flex gap-2">
                  <StatPill icon={HardDrive} label={t("inventory_detail_stat_size")} value={formatBytes(item.size_bytes)} />
                  <StatPill icon={Calendar}  label={t("inventory_detail_stat_added")} value={timeAgo(item.download_date)} />
                  {fileCount != null && <StatPill icon={Layers} label={t("inventory_detail_stat_files")} value={String(fileCount)} />}
                </div>

                {/* Tags */}
                {item.tags.length > 0 && (
                  <div>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 flex items-center gap-1"><Tag className="h-3 w-3" />{t("inventory_detail_tags")}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {item.tags.map((t) => (
                        <span key={t} className="text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-full px-2 py-0.5">{t}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 text-xs transition-colors" onClick={() => tauriOpenItemLocation(item.local_path)}>
                    <FolderOpen className="h-3.5 w-3.5" /> {t("inventory_detail_actions_open")}
                  </button>
                  {boothUrl && (
                    <a href={boothUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-300 text-xs transition-colors">
                      <ExternalLink className="h-3.5 w-3.5" /> {t("inventory_detail_actions_booth")}
                    </a>
                  )}
                  <MoveMenu item={item} folders={folders} />
                  <DeleteMenu item={item} onDeleted={onClose} />
                </div>
              </div>

              {/* RIGHT: Metadata panel */}
              <div className="p-6 flex flex-col gap-5 overflow-y-auto">
                {/* Meta fields */}
                <div className="flex flex-col gap-3">
                  <MetaField icon={User}     label={t("inventory_detail_author")}    value={item.author ?? t("inventory_detail_unknown")} />
                  <MetaField icon={Tag}      label={t("inventory_detail_source")}     value={src.label} />
                  <MetaField icon={Calendar} label={t("inventory_detail_downloaded")} value={formatDate(item.download_date)} />
                  <MetaField icon={HardDrive} label={t("inventory_detail_file_size")} value={formatBytes(item.size_bytes)} />
                  {boothUrl && (
                    <MetaField
                      icon={Link}
                      label={t("inventory_detail_booth_link")}
                      value={
                        <a href={boothUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300 flex items-center gap-1 truncate text-xs">
                          booth.pm/items/{item.source_id} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      }
                    />
                  )}
                  {item.local_path && (
                    <div>
                      <span className="text-[10px] text-zinc-600 uppercase tracking-wider flex items-center gap-1 mb-1">
                        <FolderOpen className="h-3 w-3" /> {t("inventory_detail_location")}
                      </span>
                      <p className="text-[10px] font-mono text-zinc-500 break-all leading-relaxed bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5">{item.local_path}</p>
                    </div>
                  )}
                </div>

                {/* Booth description */}
                {boothLoading && (
                  <div className="flex items-center gap-2 text-zinc-500 text-xs">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("inventory_detail_booth_fetching")}
                  </div>
                )}
                {boothDetail?.description && (
                  <div>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 flex items-center gap-1"><FileText className="h-3 w-3" />{t("inventory_detail_description")}</p>
                    <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-3">
                      <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap line-clamp-10">{boothDetail.description}</p>
                    </div>
                  </div>
                )}

                {/* Booth ratings if available */}
                {(boothDetail as any)?.rating != null && (
                  <div className="flex items-center gap-1.5 text-yellow-400">
                    <Star className="h-3.5 w-3.5 fill-yellow-400" />
                    <span className="text-sm font-semibold">{(boothDetail as any).rating.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── FILES ── */}
          {tab === "files" && (
            <div className="p-6 flex flex-col gap-6">
              {treeLoading && (
                <div className="flex items-center gap-2 text-zinc-500 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading files…
                </div>
              )}

              {fileTree && (
                <FileTreeViewer root={fileTree} label="Package contents" maxH="max-h-96" />
              )}

              {unityPackagePaths.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-zinc-800">
                    <Archive className="h-4 w-4 text-blue-400" />
                    <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">UnityPackage Contents</p>
                    {unityPackagePaths.length > 1 && <span className="text-[10px] text-zinc-600">({unityPackagePaths.length} packages)</span>}
                  </div>

                  {unityPackagePaths.length > 1 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {unityPackagePaths.map((p) => {
                        const name = p.split(/[\\/]/).pop() ?? p;
                        return (
                          <button key={p} onClick={() => setSelectedUnityPkg(p === selectedUnityPkg ? null : p)}
                            className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg border transition-colors ${selectedUnityPkg === p ? "bg-blue-900/50 border-blue-700/50 text-blue-300" : "bg-zinc-800 border-zinc-700/50 text-zinc-400 hover:border-zinc-600"}`}>
                            <FileIcon ext="unitypackage" size={11} /> {name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <UnityPackageViewer path={selectedUnityPkg ?? unityPackagePaths[0]} />
                </div>
              )}

              {!treeLoading && !fileTree && (
                <div className="flex flex-col items-center gap-2 py-12 text-zinc-600">
                  <AlertTriangle className="h-8 w-8" />
                  <p className="text-sm">Could not read package files.</p>
                </div>
              )}
            </div>
          )}

          {/* ── 3D PREVIEW ── */}
          {tab === "3d" && (
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-2 pb-3 border-b border-zinc-800">
                <span className="text-[10px] bg-amber-900/50 text-amber-400 border border-amber-800/60 rounded-full px-2 py-0.5 font-semibold">BETA</span>
                <p className="text-xs text-zinc-500">Experimental preview — supports FBX, VRM, GLB/GLTF. Requires 3D models inside the package.</p>
              </div>

              {treeLoading ? (
                <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Scanning files…
                </div>
              ) : model3DPaths.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center">
                  <Box className="h-10 w-10 text-zinc-800 mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">No 3D models found in this package</p>
                  <p className="text-xs text-zinc-600 mt-1">Compatible formats: .fbx · .vrm · .glb · .gltf · .obj</p>
                </div>
              ) : (
                <Preview3D modelPaths={model3DPaths} localBasePath={item.local_path} inventoryItems={items} currentItem={item} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── MetaField ─────────────────────────────────────────────────────────────────

function MetaField({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-zinc-600 uppercase tracking-wider flex items-center gap-1">
        <Icon className="h-3 w-3" /> {label}
      </span>
      <span className="text-xs text-zinc-300">{value}</span>
    </div>
  );
}
// src/components/inventory/VersionsTab.tsx
import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Layers,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
  Trash2,
  Archive,
  PackageOpen,
  MoreHorizontal,
  AlertTriangle,
} from "lucide-react";
import {
  ItemVariant,
  tauriGetItemVariants,
  tauriExtractSubZipToTemp,
  tauriDeleteVariant,
  tauriCompressVariant,
  tauriDecompressVariant,
  tauriGetFileTree,
  FileNode,
  InventoryItem,
} from "../../lib/tauri";
import { OpenInUnityModal } from "./OpenInUnityModal";
import { FileTreeViewer } from "./FileTreeViewver";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── VariantRow ────────────────────────────────────────────────────────────────

interface VariantRowProps {
  variant: ItemVariant;
  itemId: string;
  itemZipPath: string;
  onDeleted: () => void;
}

function VariantRow({ variant, itemId, itemZipPath, onDeleted }: VariantRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [openInUnityPath, setOpenInUnityPath] = useState<string | null>(null);
  const [isCompressed, setIsCompressed] = useState(variant.is_compressed);

  const loadTree = useCallback(async () => {
    if (tree !== null) return;
    setTreeLoading(true);
    try {
      const extractedPath = await tauriExtractSubZipToTemp(itemZipPath, variant.sub_zip_name);
      const rootNode = await tauriGetFileTree(extractedPath);
      setTree(rootNode.children ?? []);
    } catch (e) {
      console.error("Failed to load file tree", e);
      setTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, [tree, itemZipPath, variant.sub_zip_name]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tree === null) {
      loadTree();
    }
  };

  const handleOpen = async () => {
    try {
      const path = await tauriExtractSubZipToTemp(itemZipPath, variant.sub_zip_name);
      setOpenInUnityPath(path);
    } catch (e) {
      console.error("Failed to extract variant", e);
    }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await tauriDeleteVariant(itemId, variant.id);
      onDeleted();
    } catch (e) {
      console.error("Failed to delete variant", e);
    } finally {
      setActionLoading(false);
      setConfirmDelete(false);
    }
  };

  const handleCompress = async () => {
    setActionLoading(true);
    setMenuOpen(false);
    try {
      await tauriCompressVariant(itemId, variant.id);
      setIsCompressed(true);
    } catch (e) {
      console.error("Failed to compress variant", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecompress = async () => {
    setActionLoading(true);
    setMenuOpen(false);
    try {
      await tauriDecompressVariant(itemId, variant.id);
      setIsCompressed(false);
    } catch (e) {
      console.error("Failed to decompress variant", e);
    } finally {
      setActionLoading(false);
    }
  };

  // Build a minimal InventoryItem to pass to OpenInUnityModal
  const mockItem: InventoryItem = {
    id: itemId,
    name: variant.label,
    author: null,
    source: "local",
    source_id: null,
    local_path: openInUnityPath ?? "",
    thumbnail_url: null,
    download_date: "",
    size_bytes: variant.size_bytes,
    tags: [],
    is_compressed: isCompressed,
    display_name: variant.label,
    custom_cover_path: null,
    sort_order: variant.sort_order,
    product_images: [],
    custom_images: [],
    folder_id: null,
  };

  // Build a synthetic FileNode root for FileTreeViewer when tree is loaded
  const treeRoot: FileNode | null =
    tree !== null
      ? {
          name: variant.label,
          path: "",
          is_dir: true,
          size: null,
          extension: null,
          children: tree,
        }
      : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className="shrink-0 text-zinc-500">
          {variant.is_materials ? (
            <Layers className="h-4 w-4" />
          ) : (
            <Users className="h-4 w-4" />
          )}
        </div>

        {/* Label + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-100 truncate">{variant.label}</span>
            {isCompressed && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-950/60 border border-violet-900/50 text-violet-400 shrink-0">
                ZIP
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-600 truncate">{variant.sub_zip_name}</span>
            {variant.size_bytes != null && (
              <span className="text-[11px] text-zinc-600 shrink-0">
                · {formatSize(variant.size_bytes)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Open in Unity */}
          <button
            onClick={handleOpen}
            disabled={actionLoading}
            title="Open in Unity"
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium bg-violet-950/60 border border-violet-900/50 text-violet-300 hover:bg-violet-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </button>

          {/* ⋯ menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={actionLoading}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="h-3.5 w-3.5" />
              )}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-8 z-50 w-44 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden">
                {isCompressed ? (
                  <button
                    onClick={handleDecompress}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <PackageOpen className="h-3.5 w-3.5 text-zinc-500" />
                    Decompress
                  </button>
                ) : (
                  <button
                    onClick={handleCompress}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Archive className="h-3.5 w-3.5 text-zinc-500" />
                    Compress
                  </button>
                )}
                <div className="h-px bg-zinc-800 mx-2" />
                <button
                  onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/40 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* Expand toggle */}
          <button
            onClick={handleToggle}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded file tree */}
      {expanded && (
        <div className="border-t border-zinc-800 px-4 py-3">
          {treeLoading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading file tree…
            </div>
          )}
          {!treeLoading && treeRoot !== null && (
            <FileTreeViewer root={treeRoot} maxH="max-h-64" showFilterToggle />
          )}
          {!treeLoading && tree !== null && tree.length === 0 && (
            <p className="text-xs text-zinc-600 py-2">No files found.</p>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-lg bg-red-950/60 border border-red-900/50 p-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">Delete variant?</h3>
                <p className="text-xs text-zinc-500 mt-1">
                  <span className="text-zinc-300 font-medium">{variant.label}</span> will be permanently removed.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Open in Unity modal */}
      {openInUnityPath && (
        <OpenInUnityModal
          items={[mockItem]}
          onClose={() => setOpenInUnityPath(null)}
        />
      )}

      {/* Close menu on outside click */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

// ── VersionsTab ───────────────────────────────────────────────────────────────

interface VersionsTabProps {
  itemId: string;
  itemZipPath: string;
}

export function VersionsTab({ itemId, itemZipPath }: VersionsTabProps) {
  const [variants, setVariants] = useState<ItemVariant[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVariants = useCallback(async () => {
    try {
      const data = await tauriGetItemVariants(itemId);
      setVariants(data);
    } catch (e) {
      console.error("Failed to fetch variants", e);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    fetchVariants();
  }, [fetchVariants]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-600 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading variants…</span>
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-600">
        <Layers className="h-8 w-8" />
        <p className="text-sm">No variants found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {variants.map((variant) => (
        <VariantRow
          key={variant.id}
          variant={variant}
          itemId={itemId}
          itemZipPath={itemZipPath}
          onDeleted={() => setVariants((prev) => prev.filter((v) => v.id !== variant.id))}
        />
      ))}
    </div>
  );
}

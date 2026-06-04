// src/components/inventory/VersionsTab.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { useT } from "@/i18n";
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
  ImagePlus,
  X,
  Image as ImageIcon,
  LayoutList,
  LayoutGrid,
} from "lucide-react";
import {
  ItemVariant,
  tauriGetItemVariants,
  tauriExtractSubZipToTemp,
  tauriDeleteVariant,
  tauriCompressVariant,
  tauriDecompressVariant,
  tauriGetFileTree,
  tauriSetVariantCustomImage,
  FileNode,
  InventoryItem,
} from "../../lib/tauri";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { OpenInUnityModal } from "./OpenInUnityModal";
import { FileTreeViewer } from "./FileTreeViewver";
import { toAssetUrl } from "../../lib/utils";
import { ImageSourcePicker } from "./ImageSourcePicker";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── CompressAllDialog ─────────────────────────────────────────────────────────

interface CompressAllDialogProps {
  variantLabel: string;
  totalVariants: number;
  onCompressOne: () => void;
  onCompressAll: () => void;
  onCancel: () => void;
}

function CompressAllDialog({ variantLabel, totalVariants, onCompressOne, onCompressAll, onCancel }: CompressAllDialogProps) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-violet-950/60 border border-violet-900/50 p-2">
            <Archive className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{t("versions_compress_dialog_title")}</h3>
            <p className="text-xs text-zinc-500 mt-1">
              {t("versions_compress_dialog_body")
                .replace("{label}", variantLabel)
                .replace("{total}", String(totalVariants))}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={onCompressOne}
            className="py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
          >
            {t("versions_compress_only_this")}
          </button>
          <button
            onClick={onCompressAll}
            className="py-2 rounded-xl bg-violet-700 hover:bg-violet-600 text-xs font-semibold text-white transition-colors"
          >
            {t("versions_compress_all_variants").replace("{total}", String(totalVariants))}
          </button>
          <button
            onClick={onCancel}
            className="py-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {t("versions_cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PickVersionDialog ─────────────────────────────────────────────────────────

interface PickVersionDialogProps {
  variants: ItemVariant[];
  itemZipPath: string;
  onPick: (variant: ItemVariant) => void;
  onCancel: () => void;
}

function PickVersionDialog({ variants, itemZipPath, onPick, onCancel }: PickVersionDialogProps) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">{t("versions_pick_version_title")}</h3>
          <button onClick={onCancel} className="text-zinc-600 hover:text-zinc-400 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
          {variants.map((v) => {
            const thumb = v.custom_image_path ? toAssetUrl(v.custom_image_path) : null;
            return (
              <button
                key={v.id}
                onClick={() => onPick(v)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 hover:border-zinc-700 transition-colors text-left group"
              >
                {/* Thumbnail or icon */}
                <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 flex items-center justify-center">
                  {thumb ? (
                    <img src={thumb} alt="" className="w-full h-full object-cover" />
                  ) : v.is_materials ? (
                    <Layers className="h-4 w-4 text-zinc-500" />
                  ) : (
                    <Users className="h-4 w-4 text-zinc-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-200 truncate">{v.label}</p>
                  {v.size_bytes != null && (
                    <p className="text-[10px] text-zinc-600">{formatSize(v.size_bytes)}</p>
                  )}
                </div>
                <ExternalLink className="h-3.5 w-3.5 text-zinc-600 group-hover:text-violet-400 transition-colors shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── VariantRow ────────────────────────────────────────────────────────────────

interface VariantRowProps {
  variant: ItemVariant;
  itemId: string;
  itemZipPath: string;
  allVariants: ItemVariant[];
  itemImages: string[];
  onDeleted: () => void;
  onCompressAll: () => void;
  onVariantUpdated: (updated: ItemVariant) => void;
}

function VariantRow({
  variant,
  itemId,
  itemZipPath,
  allVariants,
  itemImages,
  onDeleted,
  onCompressAll,
  onVariantUpdated,
}: VariantRowProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [openInUnityPath, setOpenInUnityPath] = useState<string | null>(null);
  const [isCompressed, setIsCompressed] = useState(variant.is_compressed);
  const [showCompressAllDialog, setShowCompressAllDialog] = useState(false);
  const [customImagePath, setCustomImagePath] = useState<string | null>(variant.custom_image_path);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const thumbSrc = customImagePath
    ? (customImagePath.startsWith("http") ? customImagePath : toAssetUrl(customImagePath))
    : null;

  const loadTree = useCallback(async () => {
    if (tree !== null) return;
    setTreeLoading(true);
    setTreeError(null);
    try {
      const extractedPath = await tauriExtractSubZipToTemp(itemZipPath, variant.sub_zip_name);
      const rootNode = await tauriGetFileTree(extractedPath);
      setTree(rootNode.children ?? []);
    } catch (e) {
      console.error("Failed to load file tree", e);
      setTreeError(String(e));
      setTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, [tree, itemZipPath, variant.sub_zip_name]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && tree === null) loadTree();
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

  const doCompressOne = async () => {
    setActionLoading(true);
    setMenuOpen(false);
    setShowCompressAllDialog(false);
    try {
      await tauriCompressVariant(itemId, variant.id);
      setIsCompressed(true);
    } catch (e) {
      console.error("Failed to compress variant", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompressClick = () => {
    setMenuOpen(false);
    const uncompressedCount = allVariants.filter((v) => !v.is_compressed).length;
    if (uncompressedCount > 1) {
      setShowCompressAllDialog(true);
    } else {
      doCompressOne();
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

  const handlePickCustomImage = () => {
    setMenuOpen(false);
    setShowImagePicker(true);
  };

  const handlePickCustomImageFromComputer = async () => {
    try {
      const file = await openDialog({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (!file) return;
      const path = typeof file === "string" ? file : (file as any).path ?? null;
      if (!path) return;
      await tauriSetVariantCustomImage(variant.id, path);
      setCustomImagePath(path);
      onVariantUpdated({ ...variant, custom_image_path: path });
    } catch (e) {
      console.error("Failed to set variant image", e);
    }
  };

  const handleRemoveCustomImage = async () => {
    setMenuOpen(false);
    try {
      await tauriSetVariantCustomImage(variant.id, null);
      setCustomImagePath(null);
      onVariantUpdated({ ...variant, custom_image_path: null });
    } catch (e) {
      console.error("Failed to remove variant image", e);
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
    <>
      {showImagePicker && (
        <ImageSourcePicker
          existingImages={itemImages}
          onClose={() => setShowImagePicker(false)}
          onSelect={async (source, productImagePath) => {
            setShowImagePicker(false);
            if (source === "computer") {
              await handlePickCustomImageFromComputer();
            } else if (source === "product" && productImagePath) {
              try {
                await tauriSetVariantCustomImage(variant.id, productImagePath);
                setCustomImagePath(productImagePath);
                onVariantUpdated({ ...variant, custom_image_path: productImagePath });
              } catch (e) {
                console.error("Failed to set variant image from product", e);
              }
            }
          }}
        />
      )}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 transition-all">
        {/* Row header */}
        <div className="flex items-center gap-3 px-3 py-2.5">
          {/* Thumbnail / icon */}
          <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-800/60 flex items-center justify-center relative group/thumb">
            {thumbSrc ? (
              <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
            ) : variant.is_materials ? (
              <Layers className="h-4 w-4 text-zinc-500" />
            ) : (
              <Users className="h-4 w-4 text-zinc-500" />
            )}
            {/* Hover overlay to pick image */}
            <button
              onClick={handlePickCustomImage}
              title={t("versions_set_custom_image")}
              className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity"
            >
              <ImagePlus className="h-3.5 w-3.5 text-white" />
            </button>
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
              {variant.is_materials && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-900/40 text-amber-400 shrink-0">
                  MAT
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-zinc-600 truncate">{variant.sub_zip_name}</span>
              {variant.size_bytes != null && (
                <span className="text-[11px] text-zinc-500 shrink-0">
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
              title={t("versions_open")}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium bg-violet-950/60 border border-violet-900/50 text-violet-300 hover:bg-violet-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ExternalLink className="h-3 w-3" />
              {t("versions_open_btn")}
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
                <div className="absolute right-0 top-8 z-50 w-48 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden">
                  {/* Image options */}
                  <button
                    onClick={handlePickCustomImage}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-zinc-500" />
                    {t("versions_set_custom_image")}
                  </button>
                  {customImagePath && (
                    <button
                      onClick={handleRemoveCustomImage}
                      className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                    >
                      <ImageIcon className="h-3.5 w-3.5 text-zinc-600" />
                      {t("versions_remove_image")}
                    </button>
                  )}
                  <div className="h-px bg-zinc-800 mx-2" />
                  {/* Compress / Decompress */}
                  {isCompressed ? (
                    <button
                      onClick={handleDecompress}
                      className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      <PackageOpen className="h-3.5 w-3.5 text-zinc-500" />
                      {t("versions_decompress")}
                    </button>
                  ) : (
                    <button
                      onClick={handleCompressClick}
                      className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      <Archive className="h-3.5 w-3.5 text-zinc-500" />
                      {t("versions_compress")}
                    </button>
                  )}
                  <div className="h-px bg-zinc-800 mx-2" />
                  <button
                    onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("versions_delete_btn")}
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
                {t("versions_loading_tree")}
              </div>
            )}
            {!treeLoading && treeRoot !== null && (
              <FileTreeViewer root={treeRoot} maxH="max-h-64" showFilterToggle />
            )}
            {!treeLoading && treeError && (
              <div className="flex flex-col gap-1 py-2">
                <p className="text-xs text-red-400">{t("versions_tree_error")}</p>
                <p className="text-[10px] text-zinc-600 font-mono break-all">{treeError}</p>
                <button
                  onClick={() => { setTree(null); setTreeError(null); loadTree(); }}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 text-left mt-1 transition-colors"
                >
                  {t("versions_retry")}
                </button>
              </div>
            )}
            {!treeLoading && !treeError && tree !== null && tree.length === 0 && (
              <p className="text-xs text-zinc-600 py-2">{t("versions_no_files")}</p>
            )}
          </div>
        )}
      </div>

      {/* Compress-all dialog */}
      {showCompressAllDialog && (
        <CompressAllDialog
          variantLabel={variant.label}
          totalVariants={allVariants.filter((v) => !v.is_compressed).length}
          onCompressOne={doCompressOne}
          onCompressAll={() => {
            setShowCompressAllDialog(false);
            onCompressAll();
          }}
          onCancel={() => setShowCompressAllDialog(false)}
        />
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
                <h3 className="text-sm font-semibold text-zinc-100">{t("versions_delete_confirm_title")}</h3>
                <p className="text-xs text-zinc-500 mt-1">
                  <span className="text-zinc-300 font-medium">{variant.label}</span>{" "}
                  {t("versions_delete_confirm_body").replace("{label}", "").trimStart()}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
              >
                {t("versions_cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t("versions_delete_btn")}
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
    </>
  );
}

// ── VariantGridCard ───────────────────────────────────────────────────────────

interface VariantGridCardProps {
  variant: ItemVariant;
  itemId: string;
  itemZipPath: string;
  allVariants: ItemVariant[];
  itemImages: string[];
  onDeleted: () => void;
  onCompressAll: () => void;
  onVariantUpdated: (updated: ItemVariant) => void;
}

function VariantGridCard({
  variant,
  itemId,
  itemZipPath,
  allVariants,
  itemImages,
  onDeleted,
  onCompressAll,
  onVariantUpdated,
}: VariantGridCardProps) {
  const t = useT();
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openInUnityPath, setOpenInUnityPath] = useState<string | null>(null);
  const [customImagePath, setCustomImagePath] = useState<string | null>(variant.custom_image_path);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCompressed, setIsCompressed] = useState(variant.is_compressed);

  const thumbSrc = customImagePath
    ? (customImagePath.startsWith("http") ? customImagePath : toAssetUrl(customImagePath))
    : null;

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

  const handlePickCustomImageFromComputer = async () => {
    try {
      const file = await openDialog({
        multiple: false,
        filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
      });
      if (!file) return;
      const path = typeof file === "string" ? file : (file as any).path ?? null;
      if (!path) return;
      await tauriSetVariantCustomImage(variant.id, path);
      setCustomImagePath(path);
      onVariantUpdated({ ...variant, custom_image_path: path });
    } catch (e) {
      console.error("Failed to set variant image", e);
    }
  };

  const handleCompress = async () => {
    setMenuOpen(false);
    setActionLoading(true);
    try {
      await tauriCompressVariant(itemId, variant.id);
      setIsCompressed(true);
      onVariantUpdated({ ...variant, is_compressed: true });
    } catch (e) {
      console.error("Failed to compress", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecompress = async () => {
    setMenuOpen(false);
    setActionLoading(true);
    try {
      await tauriDecompressVariant(itemId, variant.id);
      setIsCompressed(false);
      onVariantUpdated({ ...variant, is_compressed: false });
    } catch (e) {
      console.error("Failed to decompress", e);
    } finally {
      setActionLoading(false);
    }
  };

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

  return (
    <>
      {showImagePicker && (
        <ImageSourcePicker
          existingImages={itemImages}
          onClose={() => setShowImagePicker(false)}
          onSelect={async (source, productImagePath) => {
            setShowImagePicker(false);
            if (source === "computer") {
              await handlePickCustomImageFromComputer();
            } else if (source === "product" && productImagePath) {
              try {
                await tauriSetVariantCustomImage(variant.id, productImagePath);
                setCustomImagePath(productImagePath);
                onVariantUpdated({ ...variant, custom_image_path: productImagePath });
              } catch (e) {
                console.error("Failed to set variant image from product", e);
              }
            }
          }}
        />
      )}

      <div
        className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60 transition-all hover:border-zinc-700"
      >
        {/* Image area */}
        <div className="relative aspect-square bg-zinc-800 overflow-hidden">
          {thumbSrc ? (
            <img
              src={thumbSrc}
              alt=""
              className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${isCompressed ? "blur-[3px]" : ""}`}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {variant.is_materials
                ? <Layers className="h-10 w-10 text-zinc-600" />
                : <Users className="h-10 w-10 text-zinc-600" />}
            </div>
          )}

          {/* Compressed overlay */}
          {isCompressed && (
            <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50">
              <Archive className="h-6 w-6 text-amber-400/80" />
            </div>
          )}

          {/* Hover actions overlay */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button
              onClick={handleOpen}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              <ExternalLink className="h-3 w-3" />
              {t("versions_open_btn")}
            </button>
            <button
              onClick={() => setShowImagePicker(true)}
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-colors"
              title={t("versions_set_custom_image")}
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-2 px-2.5 py-2 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-zinc-200 truncate">{variant.label}</p>
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {isCompressed && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-950/60 border border-violet-900/50 text-violet-400">ZIP</span>
              )}
              {variant.is_materials && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-900/40 text-amber-400">MAT</span>
              )}
              {variant.size_bytes != null && (
                <span className="text-[9px] text-zinc-600">{(variant.size_bytes / (1024 * 1024)).toFixed(1)} MB</span>
              )}
            </div>
          </div>

          {/* ⋯ menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={actionLoading}
              className="h-6 w-6 flex items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-8 z-50 w-44 rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); setShowImagePicker(true); }}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <ImagePlus className="h-3.5 w-3.5 text-zinc-500" />
                  {t("versions_set_custom_image")}
                </button>
                {customImagePath && (
                  <button
                    onClick={async () => {
                      setMenuOpen(false);
                      await tauriSetVariantCustomImage(variant.id, null);
                      setCustomImagePath(null);
                      onVariantUpdated({ ...variant, custom_image_path: null });
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-zinc-600" />
                    {t("versions_remove_image")}
                  </button>
                )}
                <div className="h-px bg-zinc-800 mx-2" />
                {isCompressed ? (
                  <button onClick={handleDecompress} className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <PackageOpen className="h-3.5 w-3.5 text-zinc-500" />
                    {t("versions_decompress")}
                  </button>
                ) : (
                  <button onClick={handleCompress} className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors">
                    <Archive className="h-3.5 w-3.5 text-zinc-500" />
                    {t("versions_compress")}
                  </button>
                )}
                <div className="h-px bg-zinc-800 mx-2" />
                <button
                  onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-red-400 hover:bg-red-950/40 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("versions_delete_btn")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl p-6 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-lg bg-red-950/60 border border-red-900/50 p-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">{t("versions_delete_confirm_title")}</h3>
                <p className="text-xs text-zinc-500 mt-1">
                  <span className="text-zinc-300 font-medium">{variant.label}</span>{" "}
                  {t("versions_delete_confirm_body").replace("{label}", "").trimStart()}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors">{t("versions_cancel")}</button>
              <button onClick={handleDelete} disabled={actionLoading} className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50">
                {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t("versions_delete_btn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Menu overlay */}
      {menuOpen && <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />}

      {/* Open in Unity */}
      {openInUnityPath && (
        <OpenInUnityModal items={[mockItem]} onClose={() => setOpenInUnityPath(null)} />
      )}
    </>
  );
}

// ── VersionsTab ───────────────────────────────────────────────────────────────

interface VersionsTabProps {
  itemId: string;
  itemZipPath: string;
  itemImages: string[];
}

export function VersionsTab({ itemId, itemZipPath, itemImages }: VersionsTabProps) {
  const t = useT();
  const [variants, setVariants] = useState<ItemVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [compressingAll, setCompressingAll] = useState(false);
  const [compressAllIdx, setCompressAllIdx] = useState<number | null>(null);
  const [pickVersionOpen, setPickVersionOpen] = useState(false);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

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

  // ── Compress all logic ────────────────────────────────────────────────────
  const handleCompressAll = useCallback(async () => {
    const toCompress = variants.filter((v) => !v.is_compressed);
    if (toCompress.length === 0) return;
    setCompressingAll(true);
    for (let i = 0; i < toCompress.length; i++) {
      setCompressAllIdx(i);
      try {
        await tauriCompressVariant(itemId, toCompress[i].id);
        setVariants((prev) =>
          prev.map((v) => (v.id === toCompress[i].id ? { ...v, is_compressed: true } : v))
        );
      } catch (e) {
        console.error("Failed to compress variant", toCompress[i].id, e);
      }
    }
    setCompressingAll(false);
    setCompressAllIdx(null);
  }, [variants, itemId]);

  // ── Pick version to open ──────────────────────────────────────────────────
  const handlePickedVersion = async (variant: ItemVariant) => {
    setPickVersionOpen(false);
    try {
      const path = await tauriExtractSubZipToTemp(itemZipPath, variant.sub_zip_name);
      setPendingOpenPath(path);
    } catch (e) {
      console.error("Failed to extract variant", e);
    }
  };

  const pendingOpenItem: InventoryItem | null = pendingOpenPath
    ? {
        id: itemId,
        name: variants[0]?.label ?? "Variant",
        author: null,
        source: "local",
        source_id: null,
        local_path: pendingOpenPath,
        thumbnail_url: null,
        download_date: "",
        size_bytes: null,
        tags: [],
        is_compressed: false,
        display_name: variants[0]?.label ?? "Variant",
        custom_cover_path: null,
        sort_order: 0,
        product_images: [],
        custom_images: [],
        folder_id: null,
      }
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-600 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{t("versions_loading")}</span>
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-600">
        <Layers className="h-8 w-8" />
        <p className="text-sm">{t("versions_no_variants")}</p>
      </div>
    );
  }

  const uncompressedCount = variants.filter((v) => !v.is_compressed).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-xs text-zinc-500 font-medium">
            {t("versions_variant_count")
              .replace("{count}", String(variants.length))
              .replace("{s}", variants.length !== 1 ? "s" : "")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`h-6 w-6 flex items-center justify-center transition-colors ${viewMode === "list" ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
              title={t("versions_list_view")}
            >
              <LayoutList className="h-3 w-3" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`h-6 w-6 flex items-center justify-center transition-colors ${viewMode === "grid" ? "bg-zinc-700 text-zinc-200" : "text-zinc-600 hover:text-zinc-400"}`}
              title={t("versions_grid_view")}
            >
              <LayoutGrid className="h-3 w-3" />
            </button>
          </div>

          {/* Open: if >1 variant, show picker */}
          {variants.length > 1 && (
            <button
              onClick={() => setPickVersionOpen(true)}
              className="flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              {t("versions_open_picker")}
            </button>
          )}
          {/* Compress all button */}
          {uncompressedCount > 0 && (
            <button
              onClick={handleCompressAll}
              disabled={compressingAll}
              className="flex items-center gap-1.5 h-6 px-2.5 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-700 transition-colors disabled:opacity-50"
            >
              {compressingAll ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {compressAllIdx !== null
                    ? t("versions_compressing_progress")
                        .replace("{done}", String(compressAllIdx + 1))
                        .replace("{total}", String(uncompressedCount))
                    : t("versions_compressing")}
                </>
              ) : (
                <>
                  <Archive className="h-3 w-3" />
                  {t("versions_compress_all")}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Variant list */}
      {viewMode === "list" && variants.map((variant) => (
        <VariantRow
          key={variant.id}
          variant={variant}
          itemId={itemId}
          itemZipPath={itemZipPath}
          allVariants={variants}
          itemImages={itemImages}
          onDeleted={() => setVariants((prev) => prev.filter((v) => v.id !== variant.id))}
          onCompressAll={handleCompressAll}
          onVariantUpdated={(updated) =>
            setVariants((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
          }
        />
      ))}

      {/* Variant grid */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-2 gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
          {variants.map((variant) => (
            <VariantGridCard
              key={variant.id}
              variant={variant}
              itemId={itemId}
              itemZipPath={itemZipPath}
              allVariants={variants}
              itemImages={itemImages}
              onDeleted={() => setVariants((prev) => prev.filter((v) => v.id !== variant.id))}
              onCompressAll={handleCompressAll}
              onVariantUpdated={(updated) =>
                setVariants((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
              }
            />
          ))}
        </div>
      )}

      {/* Pick version dialog */}
      {pickVersionOpen && (
        <PickVersionDialog
          variants={variants}
          itemZipPath={itemZipPath}
          onPick={handlePickedVersion}
          onCancel={() => setPickVersionOpen(false)}
        />
      )}

      {/* Open in Unity after picking */}
      {pendingOpenItem && (
        <OpenInUnityModal
          items={[pendingOpenItem]}
          onClose={() => setPendingOpenPath(null)}
        />
      )}
    </div>
  );
}

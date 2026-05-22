// src/components/inventory/InventoryItemCard.tsx
import {
  Info, FolderInput, Archive, Trash2, GripVertical,
  FolderOpen, PackageOpen,
  User, Shirt, Sparkles, Layers, Package, Check,
} from "lucide-react";
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { InventoryItem } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { useTagStore } from "../../store/tagStore";
import { useAppearanceStore } from "../../store/appearanceStore";
import { CompressionPopup } from "./CompressionPopup";
import { useT } from "../../i18n";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toAssetUrl } from "../../lib/utils";
import { OpenInUnityModal } from "./OpenInUnityModal";
import { ExternalLink } from "lucide-react";

interface Props {
  item: InventoryItem;
  viewMode: "grid" | "list";
  isSelected: boolean;
  onCheckboxToggle: () => void;
  onShiftClick?: (id: string) => void;
  isMultiSelectActive?: boolean;
  isDragging: boolean;
}

type ItemBehavior = "base" | "outfit" | "accessory" | "material" | "shader" | null;

const BEHAVIOR_ICON_CONFIG: Record<
  Exclude<ItemBehavior, null>,
  { icon: React.ElementType; color: string; bg: string; label: string }
> = {
  base: { icon: User, color: "text-amber-400", bg: "bg-amber-900/30", label: "Base" },
  outfit: { icon: Shirt, color: "text-pink-400", bg: "bg-pink-900/30", label: "Outfit" },
  accessory: { icon: Sparkles, color: "text-purple-400", bg: "bg-purple-900/30", label: "Accessory" },
  material: { icon: Layers, color: "text-lime-400", bg: "bg-lime-900/30", label: "Material" },
  shader: { icon: Layers, color: "text-green-400", bg: "bg-green-900/30", label: "Shader" },
};

function InfiniteCarousel({ images, compressed }: { images: string[]; compressed: boolean }) {
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [direction, setDirection] = useState<"left" | "right">("left");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hovered, setHovered] = useState(false);

  const advance = useCallback(() => {
    setDirection("left");
    setActive((cur) => {
      setPrev(cur);
      return (cur + 1) % images.length;
    });
  }, [images.length]);

  useEffect(() => {
    if (hovered && images.length > 1) {
      intervalRef.current = setInterval(advance, 1400);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [hovered, images.length, advance]);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    setDirection("right");
    setPrev(active);
    setActive(0);
  }, [active]);

  return (
    <div
      className="relative aspect-square bg-zinc-800 overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      {images.length === 0 && <TypePlaceholder behavior={null} size="full" />}
      {images.map((src, i) => {
        const isActive = i === active;
        const isPrev = i === prev;
        const translateActive = isActive
          ? "translateX(0%)"
          : isPrev
            ? direction === "left" ? "translateX(-100%)" : "translateX(100%)"
            : "translateX(100%)";

        return (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 w-full h-full object-cover ${compressed ? "blur-[3px]" : ""}`}
            style={{
              transform: translateActive,
              transition: "transform 380ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "transform",
              visibility: isActive || isPrev ? "visible" : "hidden",
            }}
          />
        );
      })}
      {compressed && <CompressedOverlay />}
    </div>
  );
}

function CompressedOverlay() {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/55 backdrop-blur-[2px] rounded-t-lg pointer-events-none">
      <Archive className="h-7 w-7 text-amber-400/90" />
      <span className="text-[9px] text-amber-300/80 mt-0.5 font-semibold uppercase tracking-wider">
        {t("card_compressed")}
      </span>
    </div>
  );
}

function TypePlaceholder({ behavior, size = "full" }: { behavior: ItemBehavior; size?: "full" | "sm" }) {
  const t = useT();
  if (!behavior) {
    return (
      <div className={`${size === "full" ? "w-full h-full" : "w-9 h-9"} flex flex-col items-center justify-center gap-1 text-zinc-600`}>
        <Package className={size === "full" ? "h-8 w-8" : "h-4 w-4"} />
        {size === "full" && <span className="text-[9px] uppercase tracking-wide">{t("card_no_preview")}</span>}
      </div>
    );
  }
  const cfg = BEHAVIOR_ICON_CONFIG[behavior];
  const Icon = cfg.icon;
  return (
    <div className={`${size === "full" ? "w-full h-full" : "w-9 h-9"} flex flex-col items-center justify-center gap-1 ${cfg.bg}`}>
      <Icon className={`${size === "full" ? "h-10 w-10" : "h-5 w-5"} ${cfg.color}`} />
      {size === "full" && <span className={`text-[9px] uppercase tracking-wide font-semibold ${cfg.color} opacity-80`}>{cfg.label}</span>}
    </div>
  );
}

type SubView = null | "move" | "delete";

function ContextMenu({
  item, x, y, onClose, onCompress,
}: {
  item: InventoryItem; x: number; y: number;
  onClose: () => void; onCompress: () => void;
}) {
  const t = useT();
  const { selectItem, folders, moveItem, removeItem } = useInventoryStore();
  const [sub, setSub] = useState<SubView>(null);
  const [showOpenInUnity, setShowOpenInUnity] = useState(false);   // <-- NEW
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const top = Math.min(y, window.innerHeight - 340);
  const left = Math.min(x, window.innerWidth - 228);

  return (
    <>
      <div
        ref={menuRef}
        style={{ position: "fixed", zIndex: 9999, top, left }}
        className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-56 text-sm overflow-hidden"
      >
        {sub === null && (
          <>
            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              onClick={() => { selectItem(item); onClose(); }}>
              <Info className="h-3.5 w-3.5 text-zinc-400 shrink-0" /> {t("ctx_view_details")}
            </button>

            {/* NEW "Open in Unity" button */}
            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-violet-300 hover:bg-zinc-800"
              onClick={() => { setShowOpenInUnity(true); }}>
              <ExternalLink className="h-3.5 w-3.5 shrink-0" /> Abrir en Unity
            </button>

            <div className="my-1 border-t border-zinc-800" />

            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={() => setSub("move")}>
              <FolderInput className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <span className="flex-1">{t("ctx_move_folder")}</span>
              <span className="text-zinc-600 text-xs">›</span>
            </button>
            <div className="my-1 border-t border-zinc-800" />
            {item.is_compressed ? (
              <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-blue-300 hover:bg-zinc-800"
                onClick={() => { onCompress(); onClose(); }}>
                <PackageOpen className="h-3.5 w-3.5 shrink-0" /> {t("ctx_decompress")}
              </button>
            ) : (
              <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-amber-300 hover:bg-zinc-800"
                onClick={() => { onCompress(); onClose(); }}>
                <Archive className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{t("ctx_compress")}</span>
                <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1 ml-auto">{t("ctx_compress_max")}</span>
              </button>
            )}
            <div className="my-1 border-t border-zinc-800" />
            <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400 hover:bg-zinc-800"
              onClick={() => setSub("delete")}>
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">{t("ctx_delete")}</span>
              <span className="text-zinc-600 text-xs">›</span>
            </button>
          </>
        )}
        {sub === "move" && (
          <>
            <button className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-zinc-500 hover:bg-zinc-800" onClick={() => setSub(null)}>{t("ctx_back")}</button>
            <div className="border-t border-zinc-800 mb-1" />
            {folders.length === 0 ? (
              <p className="px-3 py-2 text-[10px] text-zinc-600 italic">{t("ctx_no_folders")}</p>
            ) : folders.map((f) => (
              <button key={f.id} className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                onClick={async () => { await moveItem(item.id, f.id); onClose(); }}>
                <FolderOpen className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </>
        )}
        {sub === "delete" && (
          <>
            <button className="w-full flex items-center gap-1.5 px-3 py-2 text-[10px] text-zinc-500 hover:bg-zinc-800" onClick={() => setSub(null)}>{t("ctx_back")}</button>
            <div className="border-t border-zinc-800" />
            <p className="text-[9px] text-zinc-600 uppercase tracking-wider px-3 pt-2 pb-1">{t("ctx_where_delete")}</p>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800"
              onClick={async () => { await removeItem(item.id, "InventoryOnly"); onClose(); }}>
              <Trash2 className="h-3.5 w-3.5 text-zinc-500" /> {t("ctx_delete_inventory")}
            </button>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-orange-300 hover:bg-zinc-800"
              onClick={async () => { await removeItem(item.id, "InventoryAndDisk"); onClose(); }}>
              <Trash2 className="h-3.5 w-3.5" /> {t("ctx_delete_disk")}
            </button>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-zinc-800"
              onClick={async () => { await removeItem(item.id, "InventoryDiskAndProjects"); onClose(); }}>
              <Trash2 className="h-3.5 w-3.5" /> {t("ctx_delete_all")}
            </button>
          </>
        )}
      </div>

      {/* NEW OpenInUnityModal */}
      {showOpenInUnity && (
        <OpenInUnityModal
          items={[item]}
          onClose={() => { setShowOpenInUnity(false); onClose(); }}
        />
      )}
    </>
  );
}

// Main card component (inner)
const InventoryItemCardInner = function InventoryItemCard({ 
  item, viewMode, isSelected, onCheckboxToggle, onShiftClick, isMultiSelectActive, isDragging 
}: Props) {
  const t = useT();
  const { showTagsInGrid } = useAppearanceStore();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [compressPopup, setCompressPopup] = useState(false);
  const [compressMode, setCompressMode] = useState<"compress" | "decompress">("compress");
  const { compressItem, decompressItem, fetchAll, selectItem } = useInventoryStore();
  const { resolveItemBehavior } = useTagStore();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 180ms cubic-bezier(0.25, 1, 0.5, 1)",
    opacity: isSortableDragging || isDragging ? 0.35 : 1,
    willChange: transform ? "transform" : undefined,
    zIndex: isSortableDragging ? 1 : undefined,
    contain: "layout",
  };

  const behavior = resolveItemBehavior(item.tags);
  const sizeMb = item.size_bytes != null
    ? item.size_bytes < 1024 * 1024
      ? `${(item.size_bytes / 1024).toFixed(0)} KB`
      : `${(item.size_bytes / (1024 * 1024)).toFixed(1)} MB`
    : null;

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();

    if (isMultiSelectActive && e.shiftKey && onShiftClick) {
      onShiftClick(item.id);
      return;
    }

    selectItem(item);
  }, [item, selectItem, isMultiSelectActive, onShiftClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleCompress = useCallback(async () => {
    const mode: "compress" | "decompress" = item.is_compressed ? "decompress" : "compress";
    setCompressMode(mode);
    setCompressPopup(true);
    try {
      if (item.is_compressed) await decompressItem(item.id);
      else await compressItem(item.id);
      setCompressPopup(false);
      fetchAll();
    } catch {
      setCompressPopup(false);
    }
  }, [item.id, item.is_compressed, compressItem, decompressItem, fetchAll]);

  const handlePopupDone = useCallback(() => {
    setCompressPopup(false);
    fetchAll();
  }, [fetchAll]);

  const coverSrc = item.custom_cover_path ? toAssetUrl(item.custom_cover_path) : item.thumbnail_url ?? null;

  const carouselImages: string[] = useMemo(() => {
    const imgs: string[] = [];
    if (coverSrc) imgs.push(coverSrc);
    for (const p of item.custom_images ?? []) {
      if (!p) continue;
      const url = p.startsWith("http") ? p : (toAssetUrl(p) ?? "");
      if (url && url !== coverSrc) imgs.push(url);
    }
    for (const url of item.product_images) {
      if (url && url !== coverSrc) imgs.push(url);
    }
    return imgs.filter(Boolean);
  }, [coverSrc, item.custom_images, item.product_images]);

  // List mode render
  if (viewMode === "list") {
    return (
      <>
        <div
          ref={setNodeRef} {...attributes} {...listeners}
          className={`flex items-center gap-3 px-3 py-2 rounded hover:bg-zinc-800 transition-colors cursor-grab active:cursor-grabbing select-none ${isDragging ? "opacity-40" : ""}`}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        >
          <div className="shrink-0 text-zinc-600 hover:text-zinc-400 pointer-events-none">
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="relative w-9 h-9 rounded bg-zinc-800 shrink-0 overflow-hidden">
            {coverSrc ? (
              <img
                src={coverSrc}
                alt=""
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-cover ${item.is_compressed ? "blur-[2px]" : ""}`}
              />
            ) : (
              <TypePlaceholder behavior={behavior} size="sm" />
            )}
            {item.is_compressed && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/60">
                <Archive className="h-4 w-4 text-amber-400/80" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 truncate">{item.display_name ?? item.name}</p>
            <p className="text-xs text-zinc-500 truncate flex items-center gap-1.5">
              {item.author ?? "Unknown"}{sizeMb ? ` · ${sizeMb}` : ""}
              {item.is_compressed && <span className="text-[9px] text-amber-400/70 uppercase">{t("card_zip")}</span>}
            </p>
          </div>
        </div>
        {menuPos && <ContextMenu item={item} x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)} onCompress={handleCompress} />}
        {compressPopup && (
          <CompressionPopup
            itemId={item.id}
            itemName={item.name}
            mode={compressMode}
            onDone={handlePopupDone}
            onError={() => setCompressPopup(false)}
          />
        )}
      </>
    );
  }

  // Grid mode
  return (
    <>
      <div
        ref={setNodeRef} {...attributes} {...listeners}
        style={style}
        className={`group relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden cursor-grab active:cursor-grabbing hover:border-zinc-600 transition-all select-none ${isDragging ? "opacity-40 scale-95 drag-overlay-item" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <InfiniteCarousel images={carouselImages} compressed={item.is_compressed} />

        <button
          onClick={(e) => { e.stopPropagation(); onCheckboxToggle(); }}
          className={`absolute top-2 left-2 z-10 rounded-md border transition-all ${isSelected
              ? "opacity-100 bg-red-600 border-red-600"
              : "opacity-0 group-hover:opacity-100 bg-zinc-900/80 border-zinc-600"
            } w-5 h-5 flex items-center justify-center`}
        >
          {isSelected && <Check className="h-3 w-3 text-white" />}
        </button>

        <div className="p-1.5 h-14 flex flex-col justify-center overflow-hidden">
          <p className="text-[10px] font-medium text-zinc-200 truncate">
            {item.display_name ?? item.name}
          </p>
          <p className="text-[9px] text-zinc-500 truncate">{item.author ?? t("inventory_detail_unknown")}</p>
          {showTagsInGrid && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-0.5 max-h-4 overflow-hidden">
              {item.tags.slice(0, 2).map((tag) => (
                <span key={tag} className="text-[8px] px-1 py-0.5 bg-zinc-800 text-zinc-500 rounded truncate whitespace-nowrap">
                  {tag}
                </span>
              ))}
              {item.tags.length > 2 && <span className="text-[8px] text-zinc-600">+{item.tags.length - 2}</span>}
            </div>
          )}
        </div>

        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="h-6 w-6 flex items-center justify-center rounded bg-zinc-900/80 border border-zinc-700 text-zinc-400">
            <GripVertical className="h-3 w-3" />
          </div>
          {isMultiSelectActive && (
            <button
              onClick={(e) => { e.stopPropagation(); onCheckboxToggle(); }}
              className={`shrink-0 rounded border transition-all ${isSelected
                  ? "bg-red-600 border-red-600"
                  : "bg-zinc-800 border-zinc-600 hover:border-zinc-400"
                } w-4 h-4 flex items-center justify-center`}
            >
              {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
            </button>
          )}
        </div>
      </div>

      {menuPos && <ContextMenu item={item} x={menuPos.x} y={menuPos.y} onClose={() => setMenuPos(null)} onCompress={handleCompress} />}
      {compressPopup && (
        <CompressionPopup
          itemId={item.id}
          itemName={item.name}
          mode={compressMode}
          onDone={handlePopupDone}
          onError={() => setCompressPopup(false)}
        />
      )}
    </>
  );
};

// Memoized export
export const InventoryItemCard = React.memo(InventoryItemCardInner, (prev, next) => {
  return (
    prev.item.id === next.item.id &&
    prev.item.is_compressed === next.item.is_compressed &&
    prev.item.display_name === next.item.display_name &&
    prev.item.custom_cover_path === next.item.custom_cover_path &&
    prev.item.thumbnail_url === next.item.thumbnail_url &&
    prev.item.tags === next.item.tags &&
    prev.item.folder_id === next.item.folder_id &&
    prev.isSelected === next.isSelected &&
    prev.viewMode === next.viewMode &&
    prev.isDragging === next.isDragging
  );
});
/**
 * InventoryItemCard — Item card with full context menu.
 * Left click  → floating context menu (Info, Move, Tags, Compress, Delete).
 * Right click drag → drag to reorganize (via custom right-click sensor in InventoryGrid).
 * No-preview → icon based on item behavior type (base/outfit/accessory/material).
 */

import {
  Info, FolderInput, Archive, Trash2, GripVertical,
  FolderOpen, CheckCircle2, PackageOpen,
  User, Shirt, Sparkles, Layers, Package, Check,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { InventoryItem } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { useTagStore } from "../../store/tagStore";
import { useAppearanceStore } from "../../store/appearanceStore";
import { CompressionPopup } from "./CompressionPopup";
import { useT } from "../../i18n";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toAssetUrl } from "../../lib/utils";

interface Props {
  item: InventoryItem;
  viewMode: "grid" | "list";
  isSelected:       boolean;
  onCheckboxToggle: () => void;
  isDragging:       boolean;
}

// ── Type icon (replaces "No preview") ────────────────────────────────────────

type ItemBehavior = "base" | "outfit" | "accessory" | "material" | "shader" | null;

const BEHAVIOR_ICON_CONFIG: Record<
  Exclude<ItemBehavior, null>,
  { icon: React.ElementType; color: string; bg: string; label: string }
> = {
  base:      { icon: User,     color: "text-amber-400",  bg: "bg-amber-900/30",  label: "Base" },
  outfit:    { icon: Shirt,    color: "text-pink-400",   bg: "bg-pink-900/30",   label: "Outfit" },
  accessory: { icon: Sparkles, color: "text-purple-400", bg: "bg-purple-900/30", label: "Accessory" },
  material:  { icon: Layers,   color: "text-lime-400",   bg: "bg-lime-900/30",   label: "Material" },
  shader:    { icon: Layers,   color: "text-green-400",  bg: "bg-green-900/30",  label: "Shader" },
};

function useHoverCarousel(images: string[], delayMs = 600, intervalMs = 900) {
  const [activeIdx, setActiveIdx] = useState(0);
  const delayRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cycleRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(() => {
    if (images.length < 2) return;
    delayRef.current = setTimeout(() => {
      let idx = 1;
      setActiveIdx(idx);
      cycleRef.current = setInterval(() => {
        idx = (idx + 1) % images.length;
        setActiveIdx(idx);
      }, intervalMs);
    }, delayMs);
  }, [images.length, delayMs, intervalMs]);

  const stop = useCallback(() => {
    if (delayRef.current)  clearTimeout(delayRef.current);
    if (cycleRef.current)  clearInterval(cycleRef.current);
    delayRef.current = null;
    cycleRef.current = null;
    setActiveIdx(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { stop(); }, [stop]);

  return { activeIdx, start, stop };
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

// ── Context menu (sin Tags) ───────────────────────────────────────────────────

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
              <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1 ml-auto">max</span>
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
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function InventoryItemCard({ item, viewMode, isSelected, onCheckboxToggle, isDragging }: Props) {
  const t = useT();
  const { showTagsInGrid } = useAppearanceStore();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [compressPopup, setCompressPopup] = useState(false);
  const [compressMode, setCompressMode] = useState<"compress" | "decompress">("compress");
  const { compressItem, decompressItem, fetchAll, selectItem } = useInventoryStore();
  const { resolveItemBehavior } = useTagStore();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging: isSortableDragging } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging || isDragging ? 0.4 : 1,
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
    selectItem(item);
  }, [item, selectItem]);

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

  const CompressedOverlay = () => (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/55 backdrop-blur-[2px] rounded-t-lg pointer-events-none">
      <Archive className="h-7 w-7 text-amber-400/90" />
      <span className="text-[9px] text-amber-300/80 mt-0.5 font-semibold uppercase tracking-wider">{t("card_compressed")}</span>
    </div>
  );

  const coverSrc = item.custom_cover_path
    ? toAssetUrl(item.custom_cover_path)
    : item.thumbnail_url ?? null;

  const carouselImages: string[] = useMemo(() => {
    const imgs: string[] = [];
    if (coverSrc) imgs.push(coverSrc);
    // Imágenes custom que el usuario añadió manualmente (paths locales → asset URL)
    for (const p of item.custom_images ?? []) {
      if (!p) continue;
      const url = p.startsWith("http") ? p : (toAssetUrl(p) ?? "");
      if (url && url !== coverSrc) imgs.push(url);
    }
    // Imágenes de producto de Booth (URLs HTTP)
    for (const url of item.product_images) {
      if (url && url !== coverSrc) imgs.push(url);
    }
    return imgs.filter(Boolean);
  }, [coverSrc, item.custom_images, item.product_images]);

  const { activeIdx, start, stop } = useHoverCarousel(carouselImages);
  const displaySrc = carouselImages[activeIdx] ?? null;

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
              <img src={coverSrc} alt="" className={`w-full h-full object-cover ${item.is_compressed ? "blur-[2px]" : ""}`} />
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
              {item.is_compressed && <span className="text-[9px] text-amber-400/70 uppercase">zip</span>}
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

  return (
    <>
      <div
        ref={setNodeRef} {...attributes} {...listeners}
        style={style}
        className={`group relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden cursor-grab active:cursor-grabbing hover:border-zinc-600 transition-all select-none ${isDragging ? "opacity-40 scale-95" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => {
          // Precargar todas las imágenes del carousel
          carouselImages.forEach((src) => {
            if (src) {
              const img = new Image();
              img.src = src;
            }
          });
          start();
        }}
        onMouseLeave={stop} 
      >
        <div className="relative aspect-square bg-zinc-800 overflow-hidden">
          {/* Capa base — siempre visible, sin animación */}
          {carouselImages[0] ? (
            <img
              src={carouselImages[0]}
              alt={item.name}
              className={`absolute inset-0 w-full h-full object-cover ${item.is_compressed ? "blur-[3px]" : ""}`}
            />
          ) : (
            <TypePlaceholder behavior={behavior} size="full" />
          )}

          {/* Capa de barrido — aparece al hacer hover y cambia de imagen */}
          {carouselImages.length > 1 && activeIdx > 0 && displaySrc && (
            <img
              key={`${item.id}-${activeIdx}`}
              src={displaySrc}
              alt=""
              className={`absolute inset-0 w-full h-full object-cover inventory-sweep ${item.is_compressed ? "blur-[3px]" : ""}`}
            />
          )}

          {item.is_compressed && <CompressedOverlay />}
        </div>

        {/* Checkbox — visible on hover or when selected */}
        <button
          onClick={(e) => { e.stopPropagation(); onCheckboxToggle(); }}
          className={`absolute top-2 left-2 z-10 rounded-md border transition-all
            ${isSelected
              ? "opacity-100 bg-red-600 border-red-600"
              : "opacity-0 group-hover:opacity-100 bg-zinc-900/80 border-zinc-600"
            } w-5 h-5 flex items-center justify-center`}
        >
          {isSelected && <Check className="h-3 w-3 text-white" />}
        </button>

        <div className="p-2">
          <p className="text-xs font-medium text-zinc-200 truncate">
            {item.display_name ?? item.name}
          </p>
          <p className="text-[10px] text-zinc-500 truncate">{item.author ?? "Unknown"}</p>
          {showTagsInGrid && item.tags.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-0.5">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-[8px] px-1 py-0.5 bg-zinc-800 text-zinc-500 rounded">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Grip handle — right click drag */}
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="h-6 w-6 flex items-center justify-center rounded bg-zinc-900/80 border border-zinc-700 text-zinc-400">
            <GripVertical className="h-3 w-3" />
          </div>
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
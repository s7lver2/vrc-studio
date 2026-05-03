/**
 * InventoryItemCard — Item card with full context menu.
 * Left click  → floating context menu (Info, Move, Tags, Compress, Delete).
 * Right click drag → drag to reorganize (via custom right-click sensor in InventoryGrid).
 * No-preview → icon based on item behavior type (base/outfit/accessory/material).
 */

import {
  Info, FolderInput, Tag, Archive, Trash2, GripVertical,
  FolderOpen, CheckCircle2, X, Plus, PackageOpen,
  User, Shirt, Sparkles, Layers, Package,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useDraggable } from "@dnd-kit/core";
import { InventoryItem } from "../../lib/tauri";
import { useInventoryStore } from "../../store/inventoryStore";
import { useTagStore } from "../../store/tagStore";
import { CompressionPopup } from "./CompressionPopup";
import { useT } from "../../i18n";
import { TagInput } from "./TagInput";

interface Props {
  item: InventoryItem;
  viewMode: "grid" | "list";
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

function TypePlaceholder({ behavior, size = "full" }: { behavior: ItemBehavior; size?: "full" | "sm" }) {
  const t = useT();
  if (!behavior) {
    // Default — generic package icon
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

// ── Tag editor inline ─────────────────────────────────────────────────────────

function TagEditor({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const t = useT();
  const { updateTags } = useInventoryStore();
  const [tags, setTags] = useState<string[]>(item.tags);

  return (
    <div className="p-3 flex flex-col gap-2.5 min-w-[240px]">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("ctx_tags_section")}</p>
      <TagInput tags={tags} onChange={setTags} placeholder={t("ctx_tags_placeholder")} />
      <button
        onClick={async () => { await updateTags(item.id, tags); onClose(); }}
        className="text-[10px] bg-red-600 hover:bg-red-500 text-white rounded-lg px-3 py-1.5 flex items-center gap-1 justify-center mt-1"
      >
        <CheckCircle2 className="h-3 w-3" /> {t("ctx_tags_save")}
      </button>
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────

type SubView = null | "move" | "tags" | "delete";

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

          <button className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
            onClick={() => setSub("tags")}>
            <Tag className="h-3.5 w-3.5 text-zinc-400 shrink-0" /> {t("ctx_edit_tags")}
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

      {sub === "tags" && <TagEditor item={item} onClose={onClose} />}

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

export function InventoryItemCard({ item, viewMode }: Props) {
  const t = useT();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [compressPopup, setCompressPopup] = useState(false);
  const [compressMode, setCompressMode] = useState<"compress" | "decompress">("compress");
  const { compressItem, decompressItem, fetchAll, selectItem } = useInventoryStore();
  const { resolveItemBehavior } = useTagStore();

  // Drag: attach to the grip handle. The sensor in InventoryGrid activates on right-click.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { item } });

  const behavior = resolveItemBehavior(item.tags);

  const sizeMb = item.size_bytes != null
    ? item.size_bytes < 1024 * 1024
      ? `${(item.size_bytes / 1024).toFixed(0)} KB`
      : `${(item.size_bytes / (1024 * 1024)).toFixed(1)} MB`
    : null;

  // Left click → open item detail panel
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    selectItem(item);
  }, [item, selectItem]);

  // Right click → open context menu (drag handled by MouseSensor in InventoryGrid)
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

  if (viewMode === "list") {
    return (
      <>
        <div
          ref={setNodeRef} {...attributes}
          className={`flex items-center gap-3 px-3 py-2 rounded hover:bg-zinc-800 transition-colors cursor-pointer select-none ${isDragging ? "opacity-40" : ""}`}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
        >
          {/* Grip — right-click-drag activates dnd via custom sensor */}
          <div {...listeners} className="shrink-0 cursor-grab text-zinc-600 hover:text-zinc-400">
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="relative w-9 h-9 rounded bg-zinc-800 shrink-0 overflow-hidden">
            {item.thumbnail_url ? (
              <img src={item.thumbnail_url} alt="" className={`w-full h-full object-cover ${item.is_compressed ? "blur-[2px]" : ""}`} />
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
            <p className="text-sm text-zinc-200 truncate">{item.name}</p>
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
        ref={setNodeRef} {...attributes}
        className={`group relative flex flex-col rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden cursor-pointer hover:border-zinc-600 transition-all select-none ${isDragging ? "opacity-40 scale-95" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div className="relative aspect-square bg-zinc-800 overflow-hidden">
          {item.thumbnail_url ? (
            <img
              src={item.thumbnail_url} alt={item.name}
              className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 ${item.is_compressed ? "blur-[3px]" : ""}`}
              loading="lazy"
            />
          ) : (
            <TypePlaceholder behavior={behavior} size="full" />
          )}
          {item.is_compressed && <CompressedOverlay />}
        </div>
        <div className="p-2">
          <p className="text-xs font-medium text-zinc-200 truncate">{item.name}</p>
          <p className="text-[10px] text-zinc-500 truncate">{item.author ?? "Unknown"}</p>
        </div>
        {/* Grip handle — right click drag */}
        <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <div
            {...listeners}
            title="Right-click drag to reorganize"
            className="h-6 w-6 flex items-center justify-center rounded bg-zinc-900/80 border border-zinc-700 hover:bg-zinc-800 text-zinc-400 cursor-grab"
          >
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
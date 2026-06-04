// src/components/inventory/FolderCard.tsx
import { Folder, FolderOpen, ChevronRight, Palette, Trash2 } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { InventoryFolder } from "@/lib/tauri";
import React, { useState, useRef, useEffect } from "react";
import { FolderCustomizeModal } from "./FolderCustomizeModal";
import { useInventoryStore } from "@/store/inventoryStore";
import { toAssetUrl } from "@/lib/utils";
import { useT } from "@/i18n";

interface FolderCardProps {
  folder: InventoryFolder;
  itemCount: number;
  onOpen: (folderId: string) => void;
  isDragging: boolean;
  viewMode?: "grid" | "list";
}

interface GoUpZoneProps {
  isDragging: boolean;
}

export function GoUpZone({ isDragging }: GoUpZoneProps) {
  const t = useT();
  const { isOver, setNodeRef } = useDroppable({ id: "root" });
  if (!isDragging) return null;
  return (
    <div
      ref={setNodeRef}
      className={`
        flex items-center justify-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed
        text-xs transition-all duration-150 select-none
        ${isOver
          ? "border-blue-500 bg-blue-500/10 text-blue-300"
          : "border-zinc-700 text-zinc-600"
        }
      `}
    >
      <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        {t("folders_drop_to_root")}
    </div>
  );
}

const FolderCardInner = function FolderCardInner({ folder, itemCount, onOpen, isDragging, viewMode = "grid" }: FolderCardProps) {
  const t = useT();
  const { isOver, setNodeRef } = useDroppable({ id: `folder:${folder.id}` });
  const { removeFolder } = useInventoryStore();
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [showCustomize, setShowCustomize] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ctxMenu]);

  const folderColor = folder.color ?? "#f59e0b";
  const useCoverFill = folder.custom_image_fill === "cover" && !!folder.custom_image_path;
  const imageUrl = folder.custom_image_path ? (toAssetUrl(folder.custom_image_path) ?? "") : "";

  // LIST mode
  if (viewMode === "list") {
    return (
      <>
        <div
          ref={setNodeRef}
          onDoubleClick={() => onOpen(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY });
          }}
          className={`
            flex items-center gap-3 px-3 py-2 rounded transition-all duration-150 select-none cursor-pointer
            ${isOver && isDragging
              ? "bg-red-500/10 border border-red-500/50"
              : isDragging
                ? "border border-dashed border-zinc-700 bg-zinc-800/20"
                : "hover:bg-zinc-800/60 border border-transparent"
            }
          `}
        >
          {folder.custom_image_path ? (
            <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0">
              <img
                src={imageUrl || undefined}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="w-9 h-9 flex items-center justify-center shrink-0">
              {isOver && isDragging
                ? <FolderOpen className="h-5 w-5" style={{ color: folderColor }} />
                : <Folder className="h-5 w-5" style={{ color: folderColor }} />
              }
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 truncate">{folder.name}</p>
            {itemCount > 0 && (
              <p className="text-xs text-zinc-500">{t("folders_items_count", { count: itemCount })}</p>
            )}
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        </div>

        {ctxMenu && (
          <div
            ref={menuRef}
            style={{ position: "fixed", zIndex: 9999, top: ctxMenu.y, left: ctxMenu.x }}
            className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-48 overflow-hidden"
          >
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
              onClick={() => { setShowCustomize(true); setCtxMenu(null); }}
            >
              <Palette className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                {t("folders_customize")}
            </button>
            <div className="my-1 border-t border-zinc-800" />
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400 hover:bg-zinc-800"
              onClick={async () => { await removeFolder(folder.id); setCtxMenu(null); }}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
                {t("folders_delete")}
            </button>
          </div>
        )}

        {showCustomize && (
          <FolderCustomizeModal folder={folder} onClose={() => setShowCustomize(false)} />
        )}
      </>
    );
  }

  // GRID mode
  return (
    <>
      <div
        ref={setNodeRef}
        onDoubleClick={() => onOpen(folder.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        className={`
          relative flex flex-col items-center justify-center gap-2 aspect-square
          cursor-pointer transition-all duration-150 select-none border-2
          ${isOver && isDragging
            ? "border-red-500 bg-red-500/10 scale-105"
            : isDragging
              ? "border-dashed border-zinc-600"
              : "folder-card-base"
          }
        `}
        style={{
          background: isOver && isDragging ? undefined : "var(--card-bg)",
          borderRadius: "var(--radius-card)",
          borderColor: isOver && isDragging ? undefined : "var(--border-color)",
        }}
      >
        {/* ── MODE: grid fill — image covers entire card ── */}
        {useCoverFill && folder.custom_image_path && (
          <>
            <img
              src={imageUrl || undefined}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover z-0"
              style={{ borderRadius: "var(--radius-card)" }}
            />
            {/* Dark gradient at bottom for name readability */}
            <div
              className="absolute inset-0 z-10 pointer-events-none"
              style={{
                borderRadius: "var(--radius-card)",
                background: "linear-gradient(to bottom, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.78) 100%)",
              }}
            />
          </>
        )}

        {/* ── MODE: icon — large centered image, card bg visible ── */}
        {!useCoverFill && folder.custom_image_path && (
          <img
            src={imageUrl || undefined}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-[72%] aspect-square object-cover z-10 shadow-lg"
            style={{ borderRadius: "calc(var(--radius-card) * 0.6)" }}
          />
        )}

        {/* ── No image — folder icon ── */}
        {!folder.custom_image_path && (
          isOver && isDragging
            ? <FolderOpen className="h-10 w-10 z-10" style={{ color: folderColor }} />
            : <Folder className="h-10 w-10 z-10" style={{ color: folderColor }} />
        )}

        {/* Folder name */}
        <span
          className={`text-[11px] font-medium truncate max-w-[90%] text-center px-1 z-20 ${
            useCoverFill && folder.custom_image_path
              ? "absolute bottom-2 left-0 right-0 text-white drop-shadow-sm"
              : "text-zinc-300"
          }`}
        >
          {folder.name}
        </span>

        {itemCount > 0 && (
          <span className="absolute top-2 right-2 text-[9px] text-zinc-500 bg-zinc-900/80 px-1.5 py-0.5 rounded-full z-20">
            {itemCount}
          </span>
        )}
        <ChevronRight className="absolute bottom-2 right-2 h-3 w-3 text-zinc-400 z-20" />
      </div>

      {ctxMenu && (
        <div
          ref={menuRef}
          style={{ position: "fixed", zIndex: 9999, top: ctxMenu.y, left: ctxMenu.x }}
          className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-48 overflow-hidden"
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => { setShowCustomize(true); setCtxMenu(null); }}
          >
            <Palette className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            {t("folders_customize")}
          </button>
          <div className="my-1 border-t border-zinc-800" />
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-red-400 hover:bg-zinc-800"
            onClick={async () => { await removeFolder(folder.id); setCtxMenu(null); }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            {t("folders_delete")}
          </button>
        </div>
      )}

      {showCustomize && (
        <FolderCustomizeModal folder={folder} onClose={() => setShowCustomize(false)} />
      )}
    </>
  );
};

export const FolderCard = React.memo(FolderCardInner, (prev, next) => {
  return (
    prev.folder.id                    === next.folder.id                    &&
    prev.folder.name                  === next.folder.name                  &&
    prev.folder.color                 === next.folder.color                 &&
    prev.folder.custom_image_path     === next.folder.custom_image_path     &&  // ← AÑADIDO
    prev.folder.custom_image_fill     === next.folder.custom_image_fill     &&
    prev.itemCount                    === next.itemCount                    &&
    prev.isDragging                   === next.isDragging                   &&
    prev.viewMode                     === next.viewMode
  );
});
// src/components/inventory/GridContextMenu.tsx
import { Folder, Tag } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInventoryStore } from "@/store/inventoryStore";
import { useTagStore } from "@/store/tagStore";
import { useT } from "@/i18n";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
}

export function GridContextMenu({ x, y, onClose }: Props) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const { addFolder, selectedFolderId } = useInventoryStore();
  const [mode, setMode] = useState<null | "folder" | "tag">(null);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click outside
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  useEffect(() => {
    if (mode) setTimeout(() => inputRef.current?.focus(), 50);
  }, [mode]);

  const top  = Math.min(y, window.innerHeight - 200);
  const left = Math.min(x, window.innerWidth - 228);

  const handleConfirm = async () => {
    const val = inputValue.trim();
    if (!val || loading) return;
    setLoading(true);
    try {
      if (mode === "folder") {
        await addFolder(val, selectedFolderId ?? undefined);
      } else if (mode === "tag") {
        useTagStore.getState().addCustomTag(val);
      }
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      style={{ position: "fixed", zIndex: 9999, top, left }}
      className="bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl py-1.5 w-56 overflow-hidden"
    >
      {mode === null ? (
        <>
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider px-3 pb-1 pt-0.5 font-semibold">
            {t("grid_ctx_create")}
          </p>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => setMode("folder")}
          >
            <Folder className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            {t("grid_ctx_new_folder")}
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => setMode("tag")}
          >
            <Tag className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            {t("grid_ctx_new_tag")}
          </button>
        </>
      ) : (
        <div className="px-3 py-2.5 flex flex-col gap-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
            {mode === "folder" ? t("grid_ctx_folder_name") : t("grid_ctx_tag_name")}
          </p>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")  handleConfirm();
              if (e.key === "Escape") onClose();
            }}
            placeholder={mode === "folder" ? t("grid_ctx_folder_placeholder") : t("grid_ctx_tag_placeholder")}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5
                       text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500"
          />
          <div className="flex gap-1.5">
            {/* onMouseDown + preventDefault keeps input focused so blur doesn't fire
                before our action — fixes folder creation failing on some systems */}
            <button
              onMouseDown={(e) => { e.preventDefault(); onClose(); }}
              className="flex-1 px-2 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 text-xs hover:bg-zinc-700 transition-colors"
            >
              {t("grid_ctx_cancel")}
            </button>
            <button
              onMouseDown={(e) => { e.preventDefault(); handleConfirm(); }}
              disabled={!inputValue.trim() || loading}
              className="flex-1 px-2 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? "…" : t("grid_ctx_create")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
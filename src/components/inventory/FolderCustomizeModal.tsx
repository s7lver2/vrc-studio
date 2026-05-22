// src/components/inventory/FolderCustomizeModal.tsx
import { X, Upload } from "lucide-react";
import { useState } from "react";
import { InventoryFolder } from "@/lib/tauri";
import { useInventoryStore } from "@/store/inventoryStore";
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { toAssetUrl } from "@/lib/utils";
import { createPortal } from "react-dom";
import { useT } from "@/i18n";

const PRESET_COLORS = [
  "#f59e0b", "#ef4444", "#a855f7", "#3b82f6",
  "#22c55e", "#ec4899", "#f97316", "#06b6d4", "#e4e4e7",
];

interface Props {
  folder: InventoryFolder;
  onClose: () => void;
}

export function FolderCustomizeModal({ folder, onClose }: Props) {
  const t = useT();
  const { updateFolder } = useInventoryStore();
  const [name, setName]         = useState(folder.name);
  const [color, setColor]       = useState(folder.color ?? "#f59e0b");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageCleared, setImageCleared] = useState(false);
  const [imageFill, setImageFill] = useState<"icon" | "grid">(folder.custom_image_fill ?? "icon");
  const [imagePreview, setImagePreview] = useState<string | null>(
    toAssetUrl(folder.custom_image_path)
  );
  const [saving, setSaving] = useState(false);

  const handlePickImage = async () => {
    const file = await tauriOpenDialog({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!file || Array.isArray(file)) return;
    setImagePath(file);
    setImagePreview(toAssetUrl(file as string));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateFolder(folder.id, {
        name: name !== folder.name ? name : undefined,
        color: color !== folder.color ? color : undefined,
        image_source_path: imagePath ?? undefined,
        clear_image: imageCleared ? true : undefined,
        image_fill: imageFill !== (folder.custom_image_fill ?? "icon") ? imageFill : undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}  // ← prevent dnd-kit from capturing
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-80 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-200">{t("folders_customize_title")}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Preview */}
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-2xl border border-zinc-700 overflow-hidden flex items-center justify-center bg-zinc-800">
              {imagePreview ? (
                <img src={imagePreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg className="h-10 w-10" viewBox="0 0 24 24" fill={color}>
                  <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                </svg>
              )}
            </div>
          </div>

          {/* Nombre */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("folders_name_label")}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
            />
          </div>

          {/* Color */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("folders_color_label")}</label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    color === c ? "border-white scale-110 shadow-md" : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Imagen custom */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{t("folders_custom_image_label")}</label>
            <button
              onClick={handlePickImage}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700
                         hover:border-zinc-500 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              {imagePreview ? t("folders_change_image") : t("folders_upload_image")}
            </button>
            {imagePreview && (
              <>
                <button
                  onClick={() => { setImagePreview(null); setImagePath(null); setImageCleared(true); }}
                  className="text-[10px] text-red-400 hover:text-red-300 text-left"
                >
                  {t("folders_remove_image")}
                </button>

                {/* Toggle UI para image_fill - solo visible cuando hay imagen */}
                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                    {t("folders_image_fill_label")}
                  </label>
                  <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-[11px]">
                    {(["icon", "grid"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setImageFill(mode)}
                        className={`flex-1 px-3 py-1.5 transition-colors ${
                          imageFill === mode
                            ? "bg-zinc-200 text-zinc-900 font-semibold"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        {mode === "icon" ? t("folders_image_fill_icon") : t("folders_image_fill_grid")}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button onClick={onClose} className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:bg-zinc-700">
            {t("folders_cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? t("folders_saving") : t("folders_save")}
          </button>
        </div>
      </div>
    </div>
  );
}
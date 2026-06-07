// src/components/projects/ProjectFolderCustomizeModal.tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { X, Check, Upload, Trash2 } from "lucide-react";
import { ProjectFolder, tauriRenameProjectFolder, tauriListProjectFolders } from "@/lib/tauri";
import { useProjectsStore } from "@/store/projects";

interface Props {
  folder: ProjectFolder;
  onClose: () => void;
}

const PRESET_COLORS = [
  "#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6",
  "#ec4899", "#f97316", "#06b6d4", "#84cc16", "#6b7280",
];

const QUICK_EMOJIS = [
  "📁", "🗂️", "🎮", "🎨", "🌟", "⚡", "🔥", "💎", "🎭", "🦊",
  "🐉", "🌸", "🌊", "🏔️", "🌙", "☀️", "🎯", "🎲", "🎪", "🏆",
  "💡", "🔮", "🌈", "🦋", "🍀", "🎵", "📸", "🚀", "🤖", "👾",
];

function cn(...c: (string | boolean | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// Folder icon preview (shared display logic)
export function FolderIconDisplay({
  emoji, image, color, size = "md",
}: { emoji?: string | null; image?: string | null; color: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "lg" ? "h-10 w-10" : size === "sm" ? "h-4 w-4" : "h-6 w-6";
  const textSz = size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-xl";

  if (image) {
    return (
      <img
        src={image}
        alt=""
        className={cn(sz, "rounded object-cover shrink-0")}
      />
    );
  }
  if (emoji) {
    return <span className={cn(textSz, "leading-none shrink-0")}>{emoji}</span>;
  }
  return (
    <svg viewBox="0 0 24 24" className={cn(sz, "shrink-0")} fill={color}>
      <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

export function ProjectFolderCustomizeModal({ folder, onClose }: Props) {
  const { setFolders } = useProjectsStore();
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color ?? "#f59e0b");
  const [emoji, setEmoji] = useState(folder.emoji ?? "");
  const [image, setImage] = useState<string | null>(folder.image ?? null);
  const [saving, setSaving] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setImage(dataUrl);
      setEmoji(""); // clear emoji when image is set
    };
    reader.readAsDataURL(file);
    // reset input so same file can be picked again
    e.target.value = "";
  }, []);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await tauriRenameProjectFolder(folder.id, trimmed, color, emoji || null, image);
      const updated = await tauriListProjectFolders();
      setFolders(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <p className="text-sm font-semibold text-zinc-100">Customize folder</p>
          <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Preview */}
        <div className="flex items-center justify-center py-6 bg-zinc-950/40">
          <div
            className="flex flex-col items-center gap-2 rounded-xl p-4 border-2 w-24"
            style={{ borderColor: color + "60", background: color + "18" }}
          >
            <FolderIconDisplay emoji={emoji} image={image} color={color} size="lg" />
            <span className="text-[10px] font-semibold text-zinc-300 truncate max-w-full text-center px-1">
              {name || "Folder"}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto max-h-[60vh]">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Name</label>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {/* Image */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Custom Image</label>
            {image ? (
              <div className="flex items-center gap-2">
                <img src={image} alt="" className="h-10 w-10 rounded-lg object-cover border border-zinc-700" />
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-700 text-[11px] text-zinc-300 hover:border-zinc-500 transition-colors"
                  >
                    <Upload className="h-3 w-3" /> Change
                  </button>
                  <button
                    onClick={() => setImage(null)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-800 text-[11px] text-red-400 hover:border-red-900 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => imageInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload image…
              </button>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleImageUpload}
            />
            {image && (
              <p className="text-[10px] text-zinc-600">Image overrides emoji icon</p>
            )}
          </div>

          {/* Emoji */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Emoji Icon</label>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setEmoji("")}
                className={cn(
                  "w-7 h-7 flex items-center justify-center rounded-md border text-[10px] text-zinc-500 transition-colors",
                  !emoji ? "border-zinc-400 bg-zinc-700 text-zinc-200" : "border-zinc-700 hover:border-zinc-600"
                )}
                title="No emoji"
              >
                ∅
              </button>
              {QUICK_EMOJIS.map((em) => (
                <button
                  key={em}
                  onClick={() => { setEmoji(em); setImage(null); }}
                  className={cn(
                    "w-7 h-7 flex items-center justify-center rounded-md border text-sm transition-colors",
                    emoji === em ? "border-zinc-400 bg-zinc-700" : "border-transparent hover:border-zinc-700 hover:bg-zinc-800"
                  )}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Color</label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full transition-transform border-2"
                  style={{
                    background: c,
                    borderColor: color === c ? "white" : "transparent",
                    transform: color === c ? "scale(1.2)" : "scale(1)",
                  }}
                />
              ))}
              <button
                onClick={() => colorInputRef.current?.click()}
                className="w-6 h-6 rounded-full border-2 border-dashed border-zinc-600 flex items-center justify-center hover:border-zinc-400 transition-colors overflow-hidden"
                title="Custom color"
                style={{ background: PRESET_COLORS.includes(color) ? "transparent" : color }}
              >
                {PRESET_COLORS.includes(color) && <span className="text-[8px] text-zinc-500">+</span>}
              </button>
              <input
                ref={colorInputRef}
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="sr-only"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-zinc-800">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white transition-colors disabled:opacity-40"
          >
            {saving ? null : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

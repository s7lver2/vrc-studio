// src/components/inventory/FolderCustomizeModal.tsx
import { X, Upload, Image as ImageIcon, Shapes, Search, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo, useCallback, useRef } from "react";
import { InventoryFolder } from "@/lib/tauri";
import { useInventoryStore } from "@/store/inventoryStore";
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { toAssetUrl } from "@/lib/utils";
import { useT } from "@/i18n";
import { ImageSourcePicker } from "./ImageSourcePicker";
import { appCacheDir } from "@tauri-apps/api/path";
import { writeFile } from "@tauri-apps/plugin-fs";

// ── Constants ───────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  "#f59e0b", "#ef4444", "#a855f7", "#3b82f6",
  "#22c55e", "#ec4899", "#f97316", "#06b6d4", "#e4e4e7",
];

// SVG icon library — each entry has a display name, SVG path data (viewBox 0 0 24 24), and search tags
const ICON_LIBRARY: { name: string; path: string; tags?: string[] }[] = [
  { name: "Folder",     path: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z", tags: ["folder","files","general"] },
  { name: "Star",       path: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z", tags: ["favorite","star","best"] },
  { name: "Heart",      path: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z", tags: ["love","like","favorite"] },
  { name: "Avatar",     path: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z", tags: ["person","user","avatar","character","body"] },
  { name: "Outfit",     path: "M17.66 7.93L12 2.27 6.34 7.93c-3.12 3.12-3.12 8.19 0 11.31C7.9 20.8 9.95 21.58 12 21.58c2.05 0 4.1-.78 5.66-2.34 3.12-3.12 3.12-8.19 0-11.31z", tags: ["outfit","cloth","clothes","fashion","wear"] },
  { name: "Game",       path: "M15 7.5V2H9v5.5l3 3 3-3zM7.5 9H2v6h5.5l3-3-3-3zM9 16.5V22h6v-5.5l-3-3-3 3zM16.5 9l-3 3 3 3H22V9h-5.5z", tags: ["game","play","gamepad","controller"] },
  { name: "World",      path: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z", tags: ["world","vrc","map","globe","planet"] },
  { name: "Package",    path: "M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.42l.82-1zM5 19V8h14v11H5z", tags: ["package","box","import","asset"] },
  { name: "Prop",       path: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z", tags: ["prop","3d","object","item"] },
  { name: "Shader",     path: "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z", tags: ["shader","material","color","palette"] },
  { name: "Texture",    path: "M21 3H3C2 3 1 4 1 5v14c0 1.1.9 2 2 2h18c1 0 2-1 2-2V5c0-1-1-2-2-2zM5 17l3.5-4.5 2.5 3.01L14.5 11l4.5 6H5z", tags: ["texture","image","photo","picture"] },
  { name: "Animation",  path: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z", tags: ["animation","video","motion","play"] },
  { name: "Audio",      path: "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z", tags: ["audio","music","sound","song"] },
  { name: "Script",     path: "M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z", tags: ["script","code","dev","programming"] },
  { name: "Store",      path: "M20 4H4v2h16V4zm1 10v-2l-1-5H4l-1 5v2h1v6h10v-6h4v6h2v-6h1zm-9 4H6v-4h6v4z", tags: ["store","shop","booth","buy"] },
  { name: "Download",   path: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z", tags: ["download","import","get","install"] },
  { name: "Settings",   path: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z", tags: ["settings","gear","config","options"] },
  { name: "Lock",       path: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z", tags: ["lock","private","secure","nsfw"] },
  { name: "Tag",        path: "M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z", tags: ["tag","label","category","type"] },
  { name: "Photo",      path: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z", tags: ["photo","image","picture","gallery"] },
  { name: "Sword",      path: "M6.92 5H5L14 14l1-1-8.08-8zM19.65 2.35l-2 2A4.501 4.501 0 0 0 13 8.5c0 1.06.37 2.02.98 2.79L2 23h2l9.79-9.79c.77.61 1.73.98 2.79.98 1.67 0 3.14-.91 3.93-2.27l.21-.36-3.28-3.28L20.5 7l3.15 3.15.35-.2c.62-1.08.32-2.43-.83-3.46L21 4.91l-1.35 1.35z", tags: ["sword","weapon","item","combat"] },
  { name: "VRChat",     path: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z", tags: ["vrc","vrchat","avatar","social"] },
  { name: "Trash",      path: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z", tags: ["trash","delete","remove","archive"] },
  { name: "Bookmark",   path: "M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z", tags: ["bookmark","save","collection","wishlist"] },
  { name: "Group",      path: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z", tags: ["group","team","friends","community","people"] },
  { name: "Palette",    path: "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z", tags: ["palette","color","design","art"] },
];

const ICONS_PER_PAGE = 24;
// Default folder icon — same path as lucide-react's <Folder> used in FolderCard
const DEFAULT_FOLDER_PATH = "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Renders an SVG icon to a PNG data-URL using an offscreen canvas.
 * Returns a base64 data URL, or null on failure.
 */
function renderIconToPng(svgPath: string, color: string, sizePx = 256): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}">
        <rect width="24" height="24" fill="none"/>
        <path d="${svgPath}" fill="${color}"/>
      </svg>`;
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = sizePx;
        canvas.height = sizePx;
        const ctx = canvas.getContext("2d");
        if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
        ctx.drawImage(img, 0, 0, sizePx, sizePx);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** Converts a base64 data URL to Uint8Array bytes */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function FolderPreview({ imageSrc, iconPath, color, size = "lg" }: {
  imageSrc: string | null;
  iconPath: string;
  color: string;
  size?: "sm" | "lg";
}) {
  const dim = size === "lg" ? "w-20 h-20" : "w-12 h-12";
  const iconH = size === "lg" ? "h-10 w-10" : "h-6 w-6";
  return (
    <div className={`${dim} rounded-2xl border border-zinc-700 overflow-hidden flex items-center justify-center bg-zinc-800`}>
      {imageSrc ? (
        <img src={imageSrc} alt="" className="w-full h-full object-cover" />
      ) : (
        <svg className={iconH} viewBox="0 0 24 24" fill={color}>
          <path d={iconPath} />
        </svg>
      )}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [customMode, setCustomMode] = useState(false);
  const isPreset = PRESET_COLORS.includes(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 items-center">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { onChange(c); setCustomMode(false); }}
            className={`w-7 h-7 rounded-full border-2 transition-all ${
              value === c && !customMode ? "border-white scale-110 shadow-md" : "border-transparent hover:scale-105"
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        {/* Rainbow = custom color trigger */}
        <button
          onClick={() => setCustomMode((v) => !v)}
          className={`w-7 h-7 rounded-full border-2 transition-all overflow-hidden ${
            (!isPreset || customMode) ? "border-white scale-110" : "border-transparent hover:scale-105"
          }`}
          style={{ background: "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" }}
          title="Custom color"
        />
      </div>
      {(customMode || !isPreset) && (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full border border-zinc-600 shrink-0" style={{ backgroundColor: value }} />
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-16 rounded cursor-pointer bg-transparent border border-zinc-700 p-0.5"
          />
          <input
            type="text"
            value={value}
            onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value); }}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 font-mono outline-none focus:border-zinc-500"
            maxLength={7}
            placeholder="#ffffff"
          />
        </div>
      )}
    </div>
  );
}

function IconPicker({ selectedPath, color, onSelect }: {
  selectedPath: string;
  color: string;
  onSelect: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return ICON_LIBRARY;
    return ICON_LIBRARY.filter((ic) =>
      ic.name.toLowerCase().includes(q) || ic.tags?.some((t) => t.includes(q))
    );
  }, [query]);

  const totalPages = Math.ceil(filtered.length / ICONS_PER_PAGE);
  const clampedPage = Math.min(page, Math.max(0, totalPages - 1));
  const visible = filtered.slice(clampedPage * ICONS_PER_PAGE, (clampedPage + 1) * ICONS_PER_PAGE);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setPage(0);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={handleSearch}
          placeholder="Search icons…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-zinc-500 placeholder:text-zinc-600"
        />
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {visible.map((ic) => {
          const sel = selectedPath === ic.path;
          return (
            <button
              key={ic.name}
              onClick={() => onSelect(ic.path)}
              title={ic.name}
              className={`relative aspect-square flex items-center justify-center rounded-lg transition-all ${
                sel
                  ? "bg-violet-900/60 border border-violet-500 ring-1 ring-violet-500"
                  : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600"
              }`}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill={color}>
                <path d={ic.path} />
              </svg>
              {sel && (
                <div className="absolute top-0.5 right-0.5">
                  <Check className="h-2.5 w-2.5 text-violet-400" />
                </div>
              )}
            </button>
          );
        })}
        {visible.length === 0 && (
          <div className="col-span-6 flex items-center justify-center py-6 text-xs text-zinc-600">
            No icons found
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={clampedPage === 0}
            className="h-6 w-6 flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] text-zinc-500">{clampedPage + 1} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={clampedPage >= totalPages - 1}
            className="h-6 w-6 flex items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface Props {
  folder: InventoryFolder;
  onClose: () => void;
}

type AppearanceTab = "icon" | "image";

export function FolderCustomizeModal({ folder, onClose }: Props) {
  const t = useT();
  const { updateFolder, items } = useInventoryStore();

  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color ?? "#f59e0b");
  const [activeTab, setActiveTab] = useState<AppearanceTab>(
    folder.custom_image_path ? "image" : "icon"
  );

  // Icon tab
  const [selectedIconPath, setSelectedIconPath] = useState<string>(DEFAULT_FOLDER_PATH);

  // Image tab
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imageCleared, setImageCleared] = useState(false);
  const [imageFill, setImageFill] = useState<"icon" | "cover">(folder.custom_image_fill ?? "icon");
  const [imagePreview, setImagePreview] = useState<string | null>(
    toAssetUrl(folder.custom_image_path)
  );
  const [showImagePicker, setShowImagePicker] = useState(false);

  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Preview: in image tab show the image, in icon tab show the SVG
  const previewImageSrc = activeTab === "image" ? imagePreview : null;

  // Product images for the image picker
  const folderItems = items.filter((i) => i.folder_id === folder.id);
  const productImages = Array.from(new Set([
    ...folderItems.flatMap((i) => i.custom_images ?? []),
    ...folderItems.map((i) => i.thumbnail_url).filter(Boolean),
  ])) as string[];

  const handlePickImageFromComputer = async () => {
    const file = await tauriOpenDialog({
      multiple: false,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!file || Array.isArray(file)) return;
    setImagePath(file as string);
    setImagePreview(toAssetUrl(file as string));
    setImageCleared(false);
  };

  const handleRemoveImage = () => {
    setImagePreview(null);
    setImagePath(null);
    setImageCleared(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const opts: Parameters<typeof updateFolder>[1] = {};

      if (name !== folder.name) opts.name = name;
      if (color !== folder.color) opts.color = color;

      if (activeTab === "icon") {
        // Render the selected SVG icon to PNG and pass it as the image source.
        // This uses the existing image infrastructure without any backend changes.
        const dataUrl = await renderIconToPng(selectedIconPath, color, 256);
        if (dataUrl) {
          // Write PNG to a temp file in app cache so Rust can copy it to folder_covers/
          try {
            const cacheDir = await appCacheDir();
            const tmpPath = `${cacheDir}/folder_icon_tmp_${folder.id}.png`;
            const bytes = dataUrlToBytes(dataUrl);
            await writeFile(tmpPath, bytes);
            opts.image_source_path = tmpPath;
            opts.image_fill = "icon"; // icon display mode for SVG-generated images
          } catch {
            // If we can't write a temp file, skip the icon update — name/color still saved
          }
        }
        // Do NOT clear existing image if user just changed color/name without switching from image tab
      } else {
        // Image tab
        if (imagePath) opts.image_source_path = imagePath;
        if (imageCleared) opts.clear_image = true;
        const newFill = imageFill;
        const oldFill = folder.custom_image_fill ?? "icon";
        if (newFill !== oldFill) opts.image_fill = newFill;
      }

      await updateFolder(folder.id, opts);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {showImagePicker && (
        <ImageSourcePicker
          existingImages={productImages}
          onClose={() => setShowImagePicker(false)}
          onSelect={async (source, productImagePath) => {
            setShowImagePicker(false);
            if (source === "computer") {
              await handlePickImageFromComputer();
            } else if (source === "product" && productImagePath) {
              setImagePath(productImagePath);
              setImagePreview(toAssetUrl(productImagePath) ?? productImagePath);
              setImageCleared(false);
            }
          }}
        />
      )}

      {/* Hidden canvas for icon rendering */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[22rem] flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <span className="text-sm font-semibold text-zinc-200">{t("folders_customize_title")}</span>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-4 overflow-y-auto">

            {/* Preview */}
            <div className="flex justify-center">
              <FolderPreview
                imageSrc={previewImageSrc}
                iconPath={selectedIconPath}
                color={color}
                size="lg"
              />
            </div>

            {/* Name */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                {t("folders_name_label")}
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500 transition-colors"
              />
            </div>

            {/* Appearance tab selector */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                Appearance
              </label>
              <div className="flex rounded-xl overflow-hidden border border-zinc-700 text-xs">
                <button
                  onClick={() => setActiveTab("icon")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition-colors ${
                    activeTab === "icon"
                      ? "bg-zinc-700 text-zinc-100 font-semibold"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-300"
                  }`}
                >
                  <Shapes className="h-3.5 w-3.5" />
                  Icon
                </button>
                <button
                  onClick={() => setActiveTab("image")}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition-colors ${
                    activeTab === "image"
                      ? "bg-zinc-700 text-zinc-100 font-semibold"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-300"
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Custom image
                </button>
              </div>

              {/* ── ICON TAB ── */}
              {activeTab === "icon" && (
                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                      {t("folders_color_label")}
                    </label>
                    <ColorPicker value={color} onChange={setColor} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                      Icon shape
                    </label>
                    <IconPicker
                      selectedPath={selectedIconPath}
                      color={color}
                      onSelect={setSelectedIconPath}
                    />
                  </div>
                </div>
              )}

              {/* ── IMAGE TAB ── */}
              {activeTab === "image" && (
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    onClick={() => setShowImagePicker(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700
                               hover:border-zinc-500 text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {imagePreview ? t("folders_change_image") : t("folders_upload_image")}
                  </button>

                  {imagePreview && (
                    <>
                      <button
                        onClick={handleRemoveImage}
                        className="text-[10px] text-red-400 hover:text-red-300 text-left transition-colors"
                      >
                        {t("folders_remove_image")}
                      </button>

                      {/* Fill mode toggle */}
                      <div className="flex flex-col gap-1.5 mt-1">
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                          {t("folders_image_fill_label")}
                        </label>
                        <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-[11px]">
                          {(["icon", "cover"] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setImageFill(mode)}
                              className={`flex-1 px-3 py-1.5 transition-colors ${
                                imageFill === mode
                                  ? "bg-zinc-200 text-zinc-900 font-semibold"
                                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                              }`}
                            >
                              {mode === "icon" ? t("folders_image_fill_icon") : t("folders_image_fill_cover")}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-4 pb-4 pt-2 border-t border-zinc-800 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:bg-zinc-700 transition-colors"
            >
              {t("folders_cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-3 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {saving ? t("folders_saving") : t("folders_save")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
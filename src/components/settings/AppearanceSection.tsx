// src/components/settings/AppearanceSection.tsx

import {
    Palette, ImageIcon, Monitor, Type, LayoutGrid,
    Zap, Grid3X3, Upload, Trash2, Plus, FlaskConical,
    Monitor as MonitorIcon
    
} from "lucide-react";
import { useState, useEffect } from "react";
import {
    useAppearanceStore, THEMES, AppTheme, ThemeId,
    ALL_SECTIONS, AppSection
} from "@/store/appearanceStore";
import { BUILT_IN_SPLASH_IMAGES } from "@/lib/splashImages";
import { open as tauriOpenDialog } from "@tauri-apps/plugin-dialog";
import { toAssetUrl } from "@/lib/utils";

// ─── Componentes auxiliares ─────────────────────────────────────────

function cn(...c: (string | boolean | undefined)[]) {
    return c.filter(Boolean).join(" ");
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            onClick={() => onChange(!value)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${value ? "" : "bg-zinc-700"
                }`}
            style={value ? { background: "var(--accent-color)" } : {}}
        >
            <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? "translate-x-4" : "translate-x-1"
                    }`}
            />
        </button>
    );
}

function BetaTag() {
    return (
        <span
            className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{
                background: "rgba(251,191,36,0.12)",
                border: "1px solid rgba(251,191,36,0.4)",
                color: "#fbbf24",
            }}
        >
            <FlaskConical className="h-2 w-2" />
            BETA
        </span>
    );
}

function WallpaperPresetCard({
  isActive,
  onSelect,
  customWallpaperPath,
  onPickFile,
  onClear,
}: {
  isActive: boolean;
  onSelect: () => void;
  customWallpaperPath: string | null;
  onPickFile: () => void;
  onClear: () => void;
}) {
  const { toAssetUrl } = { toAssetUrl: (p: string | null) => {
    // importar sincrónicamente no funciona, usamos lazy
    return null; // se actualiza abajo
  }};

  // Usar toAssetUrl del lib
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    import("@/lib/utils").then(({ toAssetUrl }) => {
      setPreviewUrl(customWallpaperPath ? toAssetUrl(customWallpaperPath) : null);
    });
  }, [customWallpaperPath]);

  const accentColor = "var(--accent-color)";

  return (
    <button
      onClick={isActive ? onPickFile : onSelect}
      className="relative flex flex-col gap-0 overflow-hidden transition-all duration-200 group"
      style={{
        borderRadius: "14px",
        border: isActive
          ? `2px solid ${accentColor}`
          : "2px solid rgba(55,55,63,0.7)",
        boxShadow: isActive ? `0 0 0 3px rgba(255,255,255,0.06)` : "none",
        transform: isActive ? "scale(1.03)" : "scale(1)",
        minHeight: 90,
      }}
    >
      {/* Preview de imagen o placeholder */}
      <div
        className="w-full flex-1 relative flex items-center justify-center overflow-hidden"
        style={{
          height: 56,
          background: previewUrl ? "transparent" : "#0d0d12",
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div
            className="flex flex-col items-center gap-1 opacity-40"
            style={{ pointerEvents: "none" }}
          >
            <ImageIcon className="h-5 w-5 text-zinc-500" />
          </div>
        )}
        {/* Overlay oscuro para legibilidad */}
        {previewUrl && (
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.35)" }}
          />
        )}
        {/* "Change" hover al activar */}
        {isActive && previewUrl && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.5)" }}>
            <span className="text-[9px] font-semibold text-white tracking-wider">CHANGE</span>
          </div>
        )}
        {/* "+" si no hay imagen */}
        {!previewUrl && isActive && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-zinc-400 text-xl font-light">+</span>
          </div>
        )}
        {/* Botón X para limpiar */}
        {isActive && customWallpaperPath && (
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/60 border border-white/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="text-[8px] text-white leading-none">✕</span>
          </button>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          background: previewUrl ? "rgba(0,0,0,0.55)" : "#18181b",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          padding: "7px 10px",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <span style={{ fontSize: 12 }}>🖼️</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: isActive ? accentColor : "rgba(160,160,170,1)",
            letterSpacing: "-0.01em",
          }}
        >
          Wallpaper
        </span>
        <BetaTag />
        {isActive && (
          <div
            style={{
              marginLeft: "auto",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accentColor,
            }}
          />
        )}
      </div>
    </button>
  );
}

// ─── ThemePreviewCard (con badges Neon, CRT, Gradient) ──────────────

function ThemePreviewCard({
    theme,
    isActive,
    onSelect,
}: {
    theme: AppTheme;
    isActive: boolean;
    onSelect: () => void;
}) {
    const accentColor = `hsl(${theme.accentH} ${theme.accentS} ${theme.accentL})`;

    return (
        <button
            onClick={onSelect}
            className="relative flex flex-col gap-0 overflow-hidden transition-all duration-200"
            style={{
                borderRadius: "14px",
                border: isActive
                    ? `2px solid ${accentColor}`
                    : `2px solid ${theme.borderColor}`,
                boxShadow: isActive
                    ? `0 0 0 3px ${accentColor}18`
                    : "none",
                transform: isActive ? "scale(1.03)" : "scale(1)",
            }}
        >
            {/* Color strip */}
            <div
                className="w-full"
                style={{
                    height: 52,
                    background: theme.appBg,
                    display: "flex",
                    alignItems: "flex-end",
                    padding: "0 10px 8px",
                    gap: 4,
                }}
            >
                {/* Sidebar swatch */}
                <div style={{ width: 6, height: 28, borderRadius: 3, background: theme.sidebarBg, border: `1px solid ${theme.borderColor}` }} />
                {/* Card swatches */}
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        style={{
                            flex: 1,
                            height: i === 0 ? 28 : 20,
                            borderRadius: Number(theme.radiusSm.replace("px", "")) > 4 ? 6 : 2,
                            background: theme.cardBg,
                            border: `1px solid ${theme.borderColor}`,
                            alignSelf: "flex-end",
                        }}
                    />
                ))}
                {/* Accent dot */}
                <div
                    style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: accentColor,
                        alignSelf: "flex-start",
                        marginTop: 8,
                        flexShrink: 0,
                        boxShadow: `0 0 6px ${accentColor}80`,
                    }}
                />
            </div>

            {/* Footer */}
            <div
                style={{
                    background: theme.cardBg,
                    borderTop: `1px solid ${theme.borderColor}`,
                    padding: "7px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                }}
            >
                <span style={{ fontSize: 12 }}>{theme.emoji}</span>
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: isActive ? accentColor : theme.textPrimary,
                        letterSpacing: "-0.01em",
                    }}
                >
                    {theme.name}
                </span>
                {isActive && (
                    <div
                        style={{
                            marginLeft: "auto",
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: accentColor,
                            boxShadow: `0 0 4px ${accentColor}`,
                        }}
                    />
                )}
            </div>
        </button>
    );
}

// ─── WallpaperSection (con selector de secciones) ──────────────────

function WallpaperSection() {
    const { wallpaper, setWallpaper } = useAppearanceStore();

    const handlePickFile = async () => {
        const file = await tauriOpenDialog({
            multiple: false,
            filters: [{ name: "Images & Video", extensions: ["jpg", "jpeg", "png", "gif", "webp", "mp4", "webm"] }],
        });
        if (!file || Array.isArray(file)) return;
        const path = file as string;
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        const mediaType: "image" | "video" = ["mp4", "webm"].includes(ext) ? "video" : "image";
        setWallpaper({ path, mediaType, enabled: true });
    };

    const previewSrc = wallpaper.path ? toAssetUrl(wallpaper.path) : null;
    const SECTION_LABELS: Record<AppSection, string> = {
        projects: "Projects", packages: "Packages", shop: "Shop",
        inventory: "Inventory", settings: "Settings", logs: "Logs",
        tracker: "Tracker", creators: "Creators", git: "Git", workspace: "Workspace",
    };

    const isActive = wallpaper.enabled && !!wallpaper.path;

    return (
        <div className="flex flex-col gap-5">
            {/* Preview card — clickable to pick file */}
            <div
                className="relative rounded-2xl overflow-hidden border cursor-pointer group transition-all"
                style={{
                    minHeight: 140,
                    background: "#08080c",
                    borderColor: isActive ? "rgba(255,255,255,0.12)" : "rgb(39,39,42)",
                    boxShadow: isActive ? "0 0 0 1px rgba(255,255,255,0.06) inset" : undefined,
                }}
                onClick={handlePickFile}
            >
                {previewSrc ? (
                    <>
                        {wallpaper.mediaType === "video" ? (
                            <video
                                src={previewSrc}
                                className="w-full object-cover"
                                style={{
                                    height: 160,
                                    filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur * 0.25}px)` : undefined,
                                    opacity: isActive ? 1 : 0.35,
                                }}
                                autoPlay loop muted playsInline
                            />
                        ) : (
                            <img
                                src={previewSrc}
                                alt=""
                                className="w-full object-cover"
                                style={{
                                    height: 160,
                                    filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur * 0.25}px)` : undefined,
                                    opacity: isActive ? 1 : 0.35,
                                }}
                            />
                        )}
                        {/* Overlay darkness preview */}
                        <div
                            className="absolute inset-0 pointer-events-none"
                            style={{ background: `rgba(0,0,0,${isActive ? wallpaper.overlayOpacity : 0.6})` }}
                        />
                        {/* Hover overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                            <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-1.5">
                                <Upload className="h-3.5 w-3.5 text-white" />
                                <span className="text-xs text-white font-medium">Change background</span>
                            </div>
                        </div>
                        {/* Disabled indicator */}
                        {!isActive && (
                            <div className="absolute top-2 right-2 flex items-center gap-1 bg-zinc-900/80 rounded-full px-2 py-0.5 border border-zinc-700/50">
                                <span className="text-[9px] text-zinc-500 font-medium uppercase tracking-wider">Disabled</span>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-36 gap-3 text-zinc-700 group-hover:text-zinc-500 transition-colors">
                        <div className="rounded-2xl border border-dashed border-zinc-800 group-hover:border-zinc-600 p-4 transition-colors">
                            <Upload className="h-6 w-6" />
                        </div>
                        <p className="text-xs font-medium">Click to pick image, GIF or MP4</p>
                    </div>
                )}
            </div>

            {/* Enable toggle + remove row */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-zinc-200">Background wallpaper</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">Supports images, animated GIFs and MP4 video</p>
                </div>
                <div className="flex items-center gap-2">
                    {wallpaper.path && (
                        <button
                            onClick={() => setWallpaper({ path: null, enabled: false })}
                            className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                        >
                            Remove
                        </button>
                    )}
                    <button
                        onClick={() => setWallpaper({ enabled: !wallpaper.enabled })}
                        disabled={!wallpaper.path}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-40 ${isActive ? "" : "bg-zinc-700"}`}
                        style={isActive ? { background: "var(--accent-color)" } : {}}
                    >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isActive ? "translate-x-4" : "translate-x-1"}`} />
                    </button>
                </div>
            </div>

            {wallpaper.path && (
                <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4">
                    {/* Overlay + Blur in a 2-col grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Darkness</label>
                                <span className="text-[10px] font-mono text-zinc-400">{Math.round(wallpaper.overlayOpacity * 100)}%</span>
                            </div>
                            <input
                                type="range" min={5} max={90} step={5}
                                value={Math.round(wallpaper.overlayOpacity * 100)}
                                onChange={(e) => setWallpaper({ overlayOpacity: Number(e.target.value) / 100 })}
                                className="w-full cursor-pointer h-1.5 rounded-full appearance-none"
                                style={{ accentColor: "var(--accent-color)" }}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Blur</label>
                                <span className="text-[10px] font-mono text-zinc-400">{wallpaper.blur}px</span>
                            </div>
                            <input
                                type="range" min={0} max={20} step={1}
                                value={wallpaper.blur}
                                onChange={(e) => setWallpaper({ blur: Number(e.target.value) })}
                                className="w-full cursor-pointer h-1.5 rounded-full appearance-none"
                                style={{ accentColor: "var(--accent-color)" }}
                            />
                        </div>
                    </div>

                    {/* Fit */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">Fit</label>
                        <div className="flex gap-1.5">
                            {(["cover", "contain", "tile"] as const).map((f) => (
                                <button
                                    key={f}
                                    onClick={() => setWallpaper({ fit: f })}
                                    className="flex-1 py-1.5 rounded-lg border text-[10px] font-medium capitalize transition-all"
                                    style={wallpaper.fit === f ? {
                                        borderColor: "var(--accent-color)",
                                        background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.15)",
                                        color: "var(--accent-color)",
                                    } : { borderColor: "rgb(63,63,70)", background: "rgb(39,39,42)", color: "rgb(113,113,122)" }}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Visible in sections */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                                Visible in sections
                            </label>
                            <button
                                onClick={() => {
                                    const allSelected = ALL_SECTIONS.every(s => wallpaper.visibleSections.includes(s));
                                    setWallpaper({ visibleSections: allSelected ? [] : [...ALL_SECTIONS] });
                                }}
                                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                            >
                                {ALL_SECTIONS.every(s => wallpaper.visibleSections.includes(s)) ? "Deselect all" : "Select all"}
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                            {ALL_SECTIONS.map((section) => {
                                const isActive = wallpaper.visibleSections.includes(section);
                                return (
                                    <button
                                        key={section}
                                        onClick={() => {
                                            const next = isActive
                                                ? wallpaper.visibleSections.filter((s) => s !== section)
                                                : [...wallpaper.visibleSections, section];
                                            setWallpaper({ visibleSections: next });
                                        }}
                                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-medium transition-all text-left"
                                        style={isActive ? {
                                            borderColor: "var(--accent-color)",
                                            background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.10)",
                                            color: "var(--accent-color)",
                                        } : {
                                            borderColor: "transparent",
                                            background: "rgb(39,39,42)",
                                            color: "rgb(113,113,122)",
                                        }}
                                    >
                                        <div
                                            className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
                                            style={{ background: isActive ? "var(--accent-color)" : "rgb(63,63,70)" }}
                                        />
                                        {SECTION_LABELS[section]}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── CarouselImageManager (para loading screen) ────────────────────

function CarouselImageManager() {
    const { carouselImages, addCarouselImage, removeCarouselImage, setCarouselImages } = useAppearanceStore();

    const handleAddCustom = async () => {
        const file = await tauriOpenDialog({
            multiple: false,
            filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
        });
        if (!file || Array.isArray(file)) return;
        addCarouselImage({
            id: crypto.randomUUID(),
            path: file as string,
            builtInId: null,
        });
    };

    const handleAddBuiltIn = (builtInId: string) => {
        if (carouselImages.some((e) => e.builtInId === builtInId)) return;
        addCarouselImage({ id: crypto.randomUUID(), path: null, builtInId });
    };

    const handleUseAllBuiltIn = () => {
        setCarouselImages(
            BUILT_IN_SPLASH_IMAGES.map((img) => ({ id: img.id, path: null, builtInId: img.id }))
        );
    };

    return (
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Carousel images ({carouselImages.length === 0 ? "all built-in" : carouselImages.length})
                </p>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={handleUseAllBuiltIn}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500"
                    >
                        Use all built-in
                    </button>
                    <button
                        onClick={handleAddCustom}
                        className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border transition-colors"
                        style={{ borderColor: "var(--accent-color)", color: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.1)" }}
                    >
                        <Plus className="h-2.5 w-2.5" /> Custom
                    </button>
                </div>
            </div>

            {carouselImages.length > 0 && (
                <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                    {carouselImages.map((entry) => {
                        const meta = entry.builtInId ? BUILT_IN_SPLASH_IMAGES.find((i) => i.id === entry.builtInId) : null;
                        return (
                            <div
                                key={entry.id}
                                className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-800/50"
                            >
                                <div className="w-10 h-7 rounded overflow-hidden shrink-0 bg-zinc-700">
                                    {meta && <img src={meta.url} alt="" className="w-full h-full object-cover" />}
                                    {entry.path && !meta && (
                                        <div className="w-full h-full flex items-center justify-center text-[8px] text-zinc-500">IMG</div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[10px] font-medium text-zinc-200 truncate">
                                        {meta ? meta.title : "Custom image"}
                                    </p>
                                    <p className="text-[9px] text-zinc-600 truncate">
                                        {meta ? `by ${meta.artist}` : entry.path?.split(/[\\/]/).pop()}
                                    </p>
                                </div>
                                <button
                                    onClick={() => removeCarouselImage(entry.id)}
                                    className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div>
                <p className="text-[9px] text-zinc-600 mb-2">Add from built-in gallery:</p>
                <div className="grid grid-cols-4 gap-1.5">
                    {BUILT_IN_SPLASH_IMAGES.map((img) => {
                        const already = carouselImages.some((e) => e.builtInId === img.id);
                        return (
                            <button
                                key={img.id}
                                onClick={() => handleAddBuiltIn(img.id)}
                                disabled={already}
                                className="relative aspect-video rounded overflow-hidden border-2 transition-all disabled:opacity-40"
                                style={already ? { borderColor: "var(--accent-color)" } : { borderColor: "transparent" }}
                                title={`${img.title} — ${img.artist}`}
                            >
                                <img src={img.url} alt={img.title} className="w-full h-full object-cover" />
                                {already && (
                                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
                                        <span className="text-[8px] font-bold text-white">✓</span>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

// ─── Componente principal AppearanceSection ─────────────────────────

export function AppearanceSection() {
    const store = useAppearanceStore();
    const {
        betaFeaturesEnabled, setBetaFeaturesEnabled,
        loadingScreen, setLoadingScreen,
        shopItemSize, inventoryItemSize, uiScale,
        setShopItemSize, setInventoryItemSize, setUiScale,
        sidebarWidth, setSidebarWidth,
        customWallpaperPath, customWallpaperAccent, setCustomWallpaper, clearCustomWallpaper,
        fontSize, setFontSize,
        animSpeed, setAnimSpeed,
        bgStyle, setBgStyle,
        defaultView, setDefaultView,
        showTagsInGrid, setShowTagsInGrid,
        showTypeIcons, setShowTypeIcons,
        themeId, setThemeId,
    } = store;


    const accentBg = { borderColor: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.12)" } as React.CSSProperties;
    const accentText = { color: "var(--accent-color)" } as React.CSSProperties;

    return (
        <div className="flex flex-col gap-8">
            {/* ── BETA FEATURES MASTER TOGGLE ── */}
            <div
                className="flex flex-col gap-0 rounded-xl overflow-hidden"
                style={{
                    border: "1.5px solid rgba(251,191,36,0.3)",
                    background: "radial-gradient(ellipse at 0% 50%, rgba(251,191,36,0.05) 0%, transparent 70%)",
                }}
            >
                <div className="flex items-center gap-3 px-5 py-4">
                    <div
                        className="flex items-center justify-center h-8 w-8 rounded-lg"
                        style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)" }}
                    >
                        <FlaskConical className="h-4 w-4" style={{ color: "#fbbf24" }} />
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                            Beta Features
                            <BetaTag />
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                            Activar o desactivar todas las funciones experimentales de la app de una vez.
                        </p>
                    </div>
                    <Toggle value={betaFeaturesEnabled} onChange={setBetaFeaturesEnabled} />
                </div>
                {!betaFeaturesEnabled && (
                    <div
                        className="px-5 py-2.5 border-t"
                        style={{ borderColor: "rgba(251,191,36,0.15)", background: "rgba(251,191,36,0.04)" }}
                    >
                        <p className="text-[10px]" style={{ color: "#d97706" }}>
                            ⚠ Las features BETA están desactivadas. Los temas visuales, wallpaper personalizado y el nuevo loading screen no están disponibles.
                        </p>
                    </div>
                )}
            </div>

            {/* THEME PICKER (Presets) */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4" style={{ color: "var(--accent-color)" }} />
                    <p className="text-sm font-bold text-zinc-100">Presets</p>
                    <BetaTag />
                    <span className="ml-auto text-[10px] text-zinc-600">
                        {THEMES[themeId].name} — {THEMES[themeId].description}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {(Object.values(THEMES) as AppTheme[]).map((theme) => (
                        <ThemePreviewCard
                            key={theme.id}
                            theme={theme}
                            isActive={themeId === theme.id}
                            onSelect={() => setThemeId(theme.id as ThemeId)}
                        />
                    ))}
                </div>
            </div>

            {/* WALLPAPER / BACKGROUND (solo si beta activado) */}
            {betaFeaturesEnabled && (
                <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                        <ImageIcon className="h-3.5 w-3.5" /> Background
                        <BetaTag />
                    </p>
                    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                        <WallpaperSection />
                    </div>
                </div>
            )}

            {/* LAYOUT & TEXT */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Monitor className="h-3.5 w-3.5" /> Layout & Text
                </p>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
                    {/* UI Scale */}
                    <div className="px-5 py-4 flex items-center gap-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">UI Scale</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Overall interface zoom</p>
                        </div>
                        <div className="flex gap-1">
                            {([80, 90, 100, 110, 120] as const).map((pct) => (
                                <button
                                    key={pct}
                                    onClick={() => setUiScale(pct / 100 as any)}
                                    className="px-2 py-1 rounded-lg border text-[10px] font-semibold transition-all"
                                    style={uiScale === pct / 100
                                        ? { borderColor: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.15)", color: "var(--accent-color)" }
                                        : { borderColor: "rgb(63,63,70)", background: "rgb(39,39,42)", color: "rgb(113,113,122)" }}
                                >
                                    {pct}%
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* Font Size */}
                    <div className="px-5 py-4 flex items-center gap-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Font Size</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Base text size</p>
                        </div>
                        <div className="flex gap-1">
                            {([
                                { value: "small", label: "S" },
                                { value: "normal", label: "M" },
                                { value: "large", label: "L" },
                            ] as const).map((opt) => (
                                <button
                                    key={opt.value}
                                    onClick={() => setFontSize(opt.value)}
                                    className="w-9 py-1.5 rounded-lg border text-[10px] font-semibold transition-all"
                                    style={fontSize === opt.value
                                        ? { borderColor: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.15)", color: "var(--accent-color)" }
                                        : { borderColor: "rgb(63,63,70)", background: "rgb(39,39,42)", color: "rgb(113,113,122)" }}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* CARD SIZES */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5" /> Card Sizes
                </p>
                <div className="flex gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-5 py-4">
                    {([
                        { key: "shop", value: shopItemSize, setter: setShopItemSize, label: "Shop" },
                        { key: "inventory", value: inventoryItemSize, setter: setInventoryItemSize, label: "Inventory" },
                    ] as const).map(({ key, value, setter, label }) => (
                        <div key={key} className="flex items-center gap-3 flex-1">
                            <span className="text-xs text-zinc-500 w-16 shrink-0">{label}</span>
                            <div className="flex gap-1 flex-1">
                                {(["compact", "normal", "large"] as const).map((size) => (
                                    <button
                                        key={size}
                                        onClick={() => setter(size)}
                                        className="flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-all"
                                        style={value === size
                                            ? { borderColor: "var(--accent-color)", background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.15)", color: "var(--accent-color)" }
                                            : { borderColor: "rgb(63,63,70)", background: "rgb(39,39,42)", color: "rgb(113,113,122)" }}
                                    >
                                        {size === "compact" ? "S" : size === "normal" ? "M" : "L"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ANIMATION SPEED */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" /> Animation Speed
                </p>
                <div className="flex gap-2">
                    {(["off", "slow", "normal", "fast"] as const).map((opt) => {
                        const emoji = { off: "🚫", slow: "🐢", normal: "⚡", fast: "🚀" }[opt];
                        return (
                            <button
                                key={opt}
                                onClick={() => setAnimSpeed(opt)}
                                className={cn(
                                    "flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all capitalize",
                                    animSpeed === opt
                                        ? "border-zinc-700"
                                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                                )}
                                style={animSpeed === opt ? accentBg : {}}
                            >
                                <span className="text-xl">{emoji}</span>
                                <span className="text-[10px] text-zinc-500 font-medium">{opt}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* LOADING SCREEN (solo beta activado) */}
            {betaFeaturesEnabled && (
                <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                        <MonitorIcon className="h-3.5 w-3.5" /> Loading Screen
                    </p>
                    <div className="flex gap-3">
                        {/* Classic */}
                        <button
                            onClick={() => setLoadingScreen("classic")}
                            className="flex-1 flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left"
                            style={loadingScreen === "classic" ? {
                                borderColor: "var(--accent-color)",
                                background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.08)",
                            } : {
                                borderColor: "rgb(39,39,42)",
                                background: "rgb(24,24,27)",
                            }}
                        >
                            <div className="w-full aspect-video rounded-lg overflow-hidden flex items-center justify-center" style={{ background: "#09090b" }}>
                                <div className="flex flex-col items-center gap-2">
                                    <div className="w-8 h-8 rounded-lg" style={{ background: "rgba(220,38,38,0.3)", border: "2px solid rgba(220,38,38,0.6)" }} />
                                    <div className="w-12 h-0.5 rounded-full" style={{ background: "rgba(220,38,38,0.4)" }} />
                                </div>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-zinc-200">Classic</p>
                                <p className="text-[10px] text-zinc-500 mt-0.5">Logo + progress bar</p>
                            </div>
                        </button>

                        {/* Carousel BETA */}
                        <button
                            onClick={() => setLoadingScreen("carousel")}
                            className="flex-1 flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left"
                            style={loadingScreen === "carousel" ? {
                                borderColor: "var(--accent-color)",
                                background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.08)",
                            } : {
                                borderColor: "rgb(39,39,42)",
                                background: "rgb(24,24,27)",
                            }}
                        >
                            <div className="w-full aspect-video rounded-lg overflow-hidden relative" style={{ background: "#1a1a2e" }}>
                                <div className="absolute inset-0 opacity-60" style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }} />
                                <div className="absolute right-2 top-2 bottom-2 flex flex-col items-center justify-center gap-1" style={{ width: 16, background: "rgba(0,0,0,0.4)", borderRadius: 4 }}>
                                    <div className="w-4 h-4 rounded-sm" style={{ background: "rgba(220,38,38,0.5)" }} />
                                    <div className="w-0.5 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.2)", position: "relative" }}>
                                        <div className="absolute bottom-0 left-0 right-0 rounded-full" style={{ height: "60%", background: "rgba(255,255,255,0.7)" }} />
                                    </div>
                                </div>
                                <div className="absolute bottom-2 left-2">
                                    <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
                                    <div className="w-6 h-1 rounded-full mt-0.5" style={{ background: "rgba(255,255,255,0.1)" }} />
                                </div>
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                                    Carousel <BetaTag />
                                </p>
                                <p className="text-[10px] text-zinc-500">Artwork + vertical bar</p>
                            </div>
                        </button>
                    </div>

                    {loadingScreen === "carousel" && <CarouselImageManager />}
                </div>
            )}

            {/* GRID & LAYOUT */}
            <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                    <Grid3X3 className="h-3.5 w-3.5" /> Grid and Layout
                </p>
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden divide-y divide-zinc-800">
                    <div className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Default View Mode</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Grid or list</p>
                        </div>
                        <div className="flex gap-1.5">
                            {(["grid", "list"] as const).map((v) => (
                                <button
                                    key={v}
                                    onClick={() => setDefaultView(v)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all",
                                        defaultView === v
                                            ? "border-zinc-700"
                                            : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                                    )}
                                    style={defaultView === v ? { ...accentBg, ...accentText } : {}}
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Show tags on grid</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Show the tag badges on the grid</p>
                        </div>
                        <Toggle value={showTagsInGrid} onChange={setShowTagsInGrid} />
                    </div>
                    <div className="flex items-center gap-4 px-5 py-4">
                        <div className="flex-1">
                            <p className="text-sm font-medium text-zinc-200">Show type mockup icons</p>
                            <p className="text-[10px] text-zinc-600 mt-0.5">Avatar/outfit/accessories on cards in case the images don't load</p>
                        </div>
                        <Toggle value={showTypeIcons} onChange={setShowTypeIcons} />
                    </div>
                </div>
            </div>
        </div>
    );
}
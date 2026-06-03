/**
 * Appearance store — ajustes de personalización visual de la app.
 * Persiste en localStorage.
 */
import { create } from "zustand";

// ─── Theme System ───────────────────────────────────────────────────

export type ThemeId = "studio" | "cyberpunk" | "aurora" | "sakura" | "void" | "terminal" | "wallpaper";

export interface AppTheme {
  id: ThemeId;
  name: string;
  description: string;
  emoji: string;
  accentH: string; accentS: string; accentL: string;
  appBg: string;
  cardBg: string;
  surfaceBg: string;
  sidebarBg: string;
  borderColor: string;
  borderStrong: string;
  textPrimary: string;
  textMuted: string;
  radiusCard: string;
  radiusSm: string;
  glassCards: boolean;
  noiseOverlay: boolean;
  fontMono: boolean;
  cardShadow: string;          // e.g. "0 4px 24px rgba(0,0,0,0.6)"
  accentGlow: string;          // e.g. "0 0 12px rgba(220,38,38,0.4)"
  scanlineOpacity: number;     // 0 = off, 0.06 = visible
  neonBorders: boolean;        // si true, borders tienen glow del accent
  bgGradient: string | null;   // gradiente extra sobre --app-bg, e.g. "radial-gradient(ellipse at 20% 50%, rgba(139,92,246,0.08) 0%, transparent 60%)"
  textureUrl: string | null;   // URL de textura SVG inline (data URI) o null
  sidebarAccentLine: boolean;  // linea de acento en el lado izquierdo del sidebar
}

export interface WallpaperConfig {
  enabled: boolean;
  path: string | null;
  mediaType: "image" | "video";
  overlayOpacity: number;
  blur: number;
  fit: "cover" | "contain" | "tile";
  visibleSections: AppSection[];
}

export type AppSection =
  | "projects" | "packages" | "shop" | "inventory"
  | "settings" | "logs" | "tracker" | "creators" | "git" | "workspace";

export const ALL_SECTIONS: AppSection[] = [
  "projects", "packages", "shop", "inventory",
  "settings", "logs", "tracker", "creators", "git", "workspace",
];

export const THEMES: Record<ThemeId, AppTheme> = {
  studio: {
    id: "studio", name: "Studio", description: "El look por defecto", emoji: "🎨",
    accentH: "0", accentS: "68%", accentL: "52%",
    appBg: "#09090b", cardBg: "rgba(24,24,27,1)", surfaceBg: "rgba(34,34,37,1)",
    sidebarBg: "rgba(9,9,11,0.97)", borderColor: "rgba(55,55,63,0.7)",
    borderStrong: "rgba(75,75,84,1)", textPrimary: "rgba(224,224,228,1)",
    textMuted: "rgba(100,100,110,1)", radiusCard: "12px", radiusSm: "8px",
    glassCards: false, noiseOverlay: false, fontMono: false,
    cardShadow: "0 2px 8px rgba(0,0,0,0.4)",
    accentGlow: "0 0 8px rgba(210,40,40,0.25)",
    scanlineOpacity: 0, neonBorders: false,
    bgGradient: null, textureUrl: null, sidebarAccentLine: false,
  },
  cyberpunk: {
    id: "cyberpunk", name: "Cyberpunk", description: "Verde oscuro, bordes neon suaves", emoji: "⚡",
    accentH: "142", accentS: "60%", accentL: "42%",
    appBg: "#060c08",
    cardBg: "rgba(6,14,8,1)",
    surfaceBg: "rgba(8,20,10,1)",
    sidebarBg: "rgba(4,9,5,1)",
    borderColor: "rgba(0,180,60,0.2)",
    borderStrong: "rgba(0,200,70,0.45)",
    textPrimary: "rgba(180,230,190,0.92)",
    textMuted: "rgba(80,140,90,0.7)",
    radiusCard: "4px", radiusSm: "2px",
    glassCards: false, noiseOverlay: false, fontMono: true,
    cardShadow: "0 0 0 1px rgba(0,180,60,0.1), 0 4px 16px rgba(0,0,0,0.7)",
    accentGlow: "0 0 10px rgba(0,180,60,0.3)",
    scanlineOpacity: 0.03, neonBorders: false,
    bgGradient: null, textureUrl: null, sidebarAccentLine: true,
  },
  aurora: {
    id: "aurora", name: "Aurora", description: "Vidrio violeta profundo", emoji: "🌌",
    accentH: "268", accentS: "70%", accentL: "60%",
    appBg: "rgba(4,1,20,1)",
    cardBg: "rgba(16,6,46,0.50)",
    surfaceBg: "rgba(22,9,60,0.55)",
    sidebarBg: "rgba(5,2,18,0.97)",
    borderColor: "rgba(130,70,220,0.22)",
    borderStrong: "rgba(160,100,240,0.5)",
    textPrimary: "rgba(235,228,255,1)",
    textMuted: "rgba(140,100,220,0.6)",
    radiusCard: "16px", radiusSm: "10px",
    glassCards: true, noiseOverlay: false, fontMono: false,
    cardShadow: "0 6px 24px rgba(100,50,200,0.18), 0 2px 6px rgba(0,0,0,0.45)",
    accentGlow: "0 0 14px rgba(160,100,240,0.3)",
    scanlineOpacity: 0, neonBorders: false,
    bgGradient: "radial-gradient(ellipse at 25% 15%, rgba(90,35,180,0.09) 0%, transparent 55%)",
    textureUrl: null, sidebarAccentLine: true,
  },
  sakura: {
    id: "sakura", name: "Sakura", description: "Oceano nocturno con flor de cerezo", emoji: "🌸",
    accentH: "336", accentS: "70%", accentL: "58%",
    appBg: "rgba(4,6,18,1)",
    cardBg: "rgba(6,9,28,0.60)",
    surfaceBg: "rgba(8,12,38,0.65)",
    sidebarBg: "rgba(3,5,14,0.97)",
    borderColor: "rgba(220,90,150,0.18)",
    borderStrong: "rgba(235,110,170,0.45)",
    textPrimary: "rgba(250,228,242,1)",
    textMuted: "rgba(180,120,175,0.65)",
    radiusCard: "16px", radiusSm: "10px",
    glassCards: true, noiseOverlay: false, fontMono: false,
    cardShadow: "0 6px 24px rgba(220,90,150,0.1), 0 2px 6px rgba(0,0,0,0.35)",
    accentGlow: "0 0 12px rgba(235,110,170,0.28)",
    scanlineOpacity: 0, neonBorders: false,
    bgGradient: "radial-gradient(ellipse at 75% 8%, rgba(220,90,150,0.06) 0%, transparent 50%)",
    textureUrl: null, sidebarAccentLine: false,
  },
  void: {
    id: "void", name: "Void", description: "Vacío absoluto, azul glaciar", emoji: "🌑",
    accentH: "212", accentS: "80%", accentL: "54%",
    appBg: "#02030a",
    cardBg: "rgba(2,4,14,1)",
    surfaceBg: "rgba(3,6,20,1)",
    sidebarBg: "rgba(1,2,8,1)",
    borderColor: "rgba(20,40,90,0.8)",
    borderStrong: "rgba(40,80,180,0.35)",
    textPrimary: "rgba(185,210,250,1)",
    textMuted: "rgba(55,80,130,1)",
    radiusCard: "6px", radiusSm: "3px",
    glassCards: false, noiseOverlay: false, fontMono: false,
    cardShadow: "0 2px 6px rgba(0,0,0,0.8), inset 0 1px 0 rgba(40,80,180,0.08)",
    accentGlow: "0 0 6px rgba(40,80,180,0.35)",
    scanlineOpacity: 0, neonBorders: false,
    bgGradient: "radial-gradient(ellipse at 50% 0%, rgba(10,25,70,0.25) 0%, transparent 55%)",
    textureUrl: null, sidebarAccentLine: true,
  },
  terminal: {
    id: "terminal", name: "Terminal", description: "Fósforo verde, CRT retro", emoji: "💻",
    accentH: "120", accentS: "60%", accentL: "40%",
    appBg: "#020402",
    cardBg: "rgba(2,8,2,1)",
    surfaceBg: "rgba(3,12,3,1)",
    sidebarBg: "rgba(1,4,1,1)",
    borderColor: "rgba(0,160,0,0.2)",
    borderStrong: "rgba(0,200,0,0.4)",
    textPrimary: "rgba(0,210,0,0.92)",
    textMuted: "rgba(0,130,0,0.65)",
    radiusCard: "0px", radiusSm: "0px",
    glassCards: false, noiseOverlay: false, fontMono: true,
    cardShadow: "0 0 0 1px rgba(0,200,0,0.08), 0 4px 12px rgba(0,0,0,0.7)",
    accentGlow: "0 0 8px rgba(0,200,0,0.4)",
    scanlineOpacity: 0.04, neonBorders: false,
    bgGradient: null, textureUrl: null, sidebarAccentLine: true,
  },
  wallpaper: {
    id: "wallpaper", name: "Wallpaper", description: "Tema generado desde tu imagen", emoji: "🖼️",
    accentH: "220", accentS: "60%", accentL: "55%",   // fallback — se sobreescribe al extraer
    appBg: "transparent",
    cardBg: "rgba(0,0,0,0.42)",
    surfaceBg: "rgba(0,0,0,0.32)",
    sidebarBg: "rgba(0,0,0,0.58)",
    borderColor: "rgba(255,255,255,0.1)",
    borderStrong: "rgba(255,255,255,0.2)",
    textPrimary: "rgba(255,255,255,0.93)",
    textMuted: "rgba(255,255,255,0.48)",
    radiusCard: "12px", radiusSm: "8px",
    glassCards: true, noiseOverlay: false, fontMono: false,
    cardShadow: "0 4px 20px rgba(0,0,0,0.4)",
    accentGlow: "0 0 10px rgba(255,255,255,0.2)",
    scanlineOpacity: 0, neonBorders: false,
    bgGradient: null, textureUrl: null, sidebarAccentLine: false,
  },
};

const DEFAULT_WALLPAPER: WallpaperConfig = {
  enabled: false, path: null, mediaType: "image",
  overlayOpacity: 0.55, blur: 0, fit: "cover",
  visibleSections: [...ALL_SECTIONS], // por defecto, todas
};

export interface CarouselImageEntry {
  id: string;
  path: string | null;       // null = usa built-in
  builtInId: string | null;  // id de splashImages.ts, null = custom
}

export type ItemSize = "compact" | "normal" | "large";
export type UiScale = 0.8 | 0.9 | 1.0 | 1.1 | 1.2;
export type SidebarWidth = "narrow" | "normal" | "wide";
export type FontSize = "small" | "normal" | "large";
export type AnimSpeed = "off" | "slow" | "normal" | "fast";
export type AccentColor = "red" | "violet" | "blue" | "emerald" | "amber" | "pink" | string;
export type BgStyle = "zinc-950" | "black" | "zinc-900";
export type DefaultView = "grid" | "list";

export interface AppearanceState {
  shopItemSize: ItemSize;
  inventoryItemSize: ItemSize;
  uiScale: UiScale;
  showTagsInGrid: boolean;
  showTypeIcons: boolean;
  sidebarWidth: SidebarWidth;
  fontSize: FontSize;
  animSpeed: AnimSpeed;
  accentColor: AccentColor;
  bgStyle: BgStyle;
  // Theme system
  themeId: ThemeId;
  betaFeaturesEnabled: boolean;
  wallpaper: WallpaperConfig;
  defaultView: DefaultView;
  loadingScreen: "classic" | "carousel";
  carouselImages: CarouselImageEntry[];
  customWallpaperPath: string | null;
  customWallpaperAccent: { h: string; s: string; l: string } | null;

  setShopItemSize: (size: ItemSize) => void;
  setInventoryItemSize: (size: ItemSize) => void;
  setUiScale: (scale: UiScale) => void;
  setShowTagsInGrid: (v: boolean) => void;
  setShowTypeIcons: (v: boolean) => void;
  setSidebarWidth: (v: SidebarWidth) => void;
  setFontSize: (v: FontSize) => void;
  setAnimSpeed: (v: AnimSpeed) => void;
  setAccentColor: (v: AccentColor) => void;
  setBgStyle: (v: BgStyle) => void;
  setDefaultView: (v: DefaultView) => void;
  setThemeId: (id: ThemeId) => void;
  setWallpaper: (cfg: Partial<WallpaperConfig>) => void;
  setBetaFeaturesEnabled: (v: boolean) => void;
  setLoadingScreen: (v: "classic" | "carousel") => void;
  setCarouselImages: (images: CarouselImageEntry[]) => void;
  addCarouselImage: (entry: CarouselImageEntry) => void;
  removeCarouselImage: (id: string) => void;
  setCustomWallpaper: (path: string) => Promise<void>;
  clearCustomWallpaper: () => void;
}

const STORAGE_KEY = "app:appearance";

// Corrige el tipo de retorno de load()
function load(): Omit<AppearanceState,
  "setShopItemSize" | "setInventoryItemSize" | "setUiScale" |
  "setShowTagsInGrid" | "setShowTypeIcons" | "setSidebarWidth" |
  "setFontSize" | "setAnimSpeed" | "setAccentColor" | "setBgStyle" |
  "setDefaultView" | "setThemeId" | "setWallpaper" |
  "setBetaFeaturesEnabled" | "setLoadingScreen" | "setCarouselImages" |
  "addCarouselImage" | "removeCarouselImage" | "setCustomWallpaper" | "clearCustomWallpaper"
> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        shopItemSize: (parsed.shopItemSize ?? "normal") as ItemSize,
        inventoryItemSize: (parsed.inventoryItemSize ?? "normal") as ItemSize,
        uiScale: (parsed.uiScale ?? 1.0) as UiScale,
        showTagsInGrid: parsed.showTagsInGrid ?? false,
        showTypeIcons: parsed.showTypeIcons ?? true,
        sidebarWidth: (parsed.sidebarWidth ?? "normal") as SidebarWidth,
        fontSize: (parsed.fontSize ?? "normal") as FontSize,
        animSpeed: (parsed.animSpeed ?? "normal") as AnimSpeed,
        accentColor: parsed.accentColor ?? "red",
        bgStyle: (parsed.bgStyle ?? "zinc-950") as BgStyle,
        defaultView: (parsed.defaultView ?? "grid") as DefaultView,
        themeId: (parsed.themeId ?? "studio") as ThemeId,
        customWallpaperPath: parsed.customWallpaperPath ?? null,
        customWallpaperAccent: parsed.customWallpaperAccent ?? null,
        wallpaper: parsed.wallpaper
          ? {
            ...DEFAULT_WALLPAPER,
            ...parsed.wallpaper,
            visibleSections: parsed.wallpaper.visibleSections ?? [...ALL_SECTIONS]
          }
          : DEFAULT_WALLPAPER,
        betaFeaturesEnabled: parsed.betaFeaturesEnabled ?? true,
        loadingScreen: (parsed.loadingScreen ?? "classic") as "classic" | "carousel",
        carouselImages: parsed.carouselImages ?? [],

      };
    }
  } catch { }

  return {
    shopItemSize: "normal" as ItemSize,
    inventoryItemSize: "normal" as ItemSize,
    uiScale: 1.0 as UiScale,
    showTagsInGrid: false,
    showTypeIcons: true,
    sidebarWidth: "normal" as SidebarWidth,
    fontSize: "normal" as FontSize,
    animSpeed: "normal" as AnimSpeed,
    accentColor: "red",
    bgStyle: "zinc-950" as BgStyle,
    defaultView: "grid" as DefaultView,
    themeId: "studio" as ThemeId,
    customWallpaperPath: null,
    customWallpaperAccent: null,
    wallpaper: DEFAULT_WALLPAPER,
    betaFeaturesEnabled: true,
    loadingScreen: "classic" as const,
    carouselImages: [],
  };
}

function save(state: Partial<AppearanceState>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { }
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  ...load(),

  setShopItemSize: (shopItemSize) => {
    set({ shopItemSize });
    save({ ...get(), shopItemSize });
  },

  setBetaFeaturesEnabled: (betaFeaturesEnabled) => {
    set({ betaFeaturesEnabled });
    save({ ...get(), betaFeaturesEnabled });
  },
  setLoadingScreen: (loadingScreen) => {
    set({ loadingScreen });
    save({ ...get(), loadingScreen });
  },
  setCarouselImages: (carouselImages) => {
    set({ carouselImages });
    save({ ...get(), carouselImages });
  },
  addCarouselImage: (entry) => {
    const carouselImages = [...get().carouselImages, entry];
    set({ carouselImages });
    save({ ...get(), carouselImages });
  },
  removeCarouselImage: (id) => {
    const carouselImages = get().carouselImages.filter((e) => e.id !== id);
    set({ carouselImages });
    save({ ...get(), carouselImages });
  },

  setInventoryItemSize: (inventoryItemSize) => {
    set({ inventoryItemSize });
    save({ ...get(), inventoryItemSize });
  },

  setUiScale: (uiScale) => {
    set({ uiScale });
    save({ ...get(), uiScale });
    // Aplicar inmediatamente al documento
    applyUiScale(uiScale);
  },
  setShowTagsInGrid: (showTagsInGrid) => {
    set({ showTagsInGrid });
    save({ ...get(), showTagsInGrid });
  },
  setShowTypeIcons: (showTypeIcons) => {
    set({ showTypeIcons });
    save({ ...get(), showTypeIcons });
  },
  setSidebarWidth: (sidebarWidth) => { set({ sidebarWidth }); save({ ...get(), sidebarWidth }); applySidebarWidth(sidebarWidth); },
  setFontSize: (fontSize) => { set({ fontSize }); save({ ...get(), fontSize }); applyFontSize(fontSize); },
  setAnimSpeed: (animSpeed) => { set({ animSpeed }); save({ ...get(), animSpeed }); applyAnimSpeed(animSpeed); },
  setAccentColor: (accentColor) => { set({ accentColor }); save({ ...get(), accentColor }); applyAccentColor(accentColor); },
  setBgStyle: (bgStyle) => { set({ bgStyle }); save({ ...get(), bgStyle }); applyBgStyle(bgStyle); },
  setDefaultView: (defaultView) => { set({ defaultView }); save({ ...get(), defaultView }); },
  setCustomWallpaper: async (path: string) => {
    const { toAssetUrl } = await import("@/lib/utils");
    const { extractDominantAccent } = await import("@/lib/colorExtract");

    const url = toAssetUrl(path);
    const accent = url ? await extractDominantAccent(url) : null;

    // Guardar en store
    set({ customWallpaperPath: path, customWallpaperAccent: accent });
    save({ ...get(), customWallpaperPath: path, customWallpaperAccent: accent });

    // Activar wallpaper con este path
    const wallpaper: WallpaperConfig = {
      ...get().wallpaper,
      enabled: true,
      path,
      mediaType: "image",
    };
    set({ wallpaper, themeId: "wallpaper" });
    save({ ...get(), wallpaper, themeId: "wallpaper" });

    // Aplicar tema + accent extraído
    applyTheme(THEMES["wallpaper"]);
    if (accent) {
      const root = document.documentElement;
      root.style.setProperty("--accent-h", accent.h);
      root.style.setProperty("--accent-s", accent.s);
      root.style.setProperty("--accent-l", accent.l);
    }
    applyWallpaperCSS(wallpaper, THEMES["wallpaper"]);
  },

  clearCustomWallpaper: () => {
    set({ customWallpaperPath: null, customWallpaperAccent: null });
    save({ ...get(), customWallpaperPath: null, customWallpaperAccent: null });

    // Si el tema activo es wallpaper, volver a studio y desactivar wallpaper
    if (get().themeId === "wallpaper") {
      const wallpaper = { ...get().wallpaper, enabled: false, path: null };
      set({ themeId: "studio", wallpaper });
      save({ ...get(), themeId: "studio", wallpaper });
      applyTheme(THEMES["studio"]);
      applyWallpaperCSS(wallpaper, THEMES["studio"]);
    }
  },
  setThemeId: (themeId) => {
    const prev = get().themeId;
    set({ themeId });
    save({ ...get(), themeId });

    if (themeId === "wallpaper") {
      // Activar wallpaper con el path guardado
      const path = get().customWallpaperPath;
      if (path) {
        const wallpaper = { ...get().wallpaper, enabled: true, path, mediaType: "image" as const };
        set({ wallpaper });
        save({ ...get(), wallpaper });
        applyTheme(THEMES["wallpaper"]);
        const accent = get().customWallpaperAccent;
        if (accent) {
          const root = document.documentElement;
          root.style.setProperty("--accent-h", accent.h);
          root.style.setProperty("--accent-s", accent.s);
          root.style.setProperty("--accent-l", accent.l);
        }
        applyWallpaperCSS(wallpaper, THEMES["wallpaper"]);
      } else {
        // Sin imagen aún: solo aplicar el tema base
        applyTheme(THEMES["wallpaper"]);
      }
    } else {
      // Saliendo del tema wallpaper: desactivar el wallpaper
      if (prev === "wallpaper") {
        const wallpaper = { ...get().wallpaper, enabled: false };
        set({ wallpaper });
        save({ ...get(), wallpaper });
        applyWallpaperCSS(wallpaper, THEMES[themeId]);
      }
      applyTheme(THEMES[themeId]);
    }
  },

  setWallpaper: (partial) => {
    const wallpaper = { ...get().wallpaper, ...partial };
    set({ wallpaper });
    save({ ...get(), wallpaper });
    applyWallpaperCSS(wallpaper, THEMES[get().themeId]);
  },
}));

// src/store/appearanceStore.ts — al final del archivo

const FONT_MAP: Record<FontSize, string> = {
  small: "13px", normal: "14px", large: "15px",
};
export function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty("--base-font-size", FONT_MAP[size]);
}

const ANIM_MAP: Record<AnimSpeed, string> = {
  off: "0", slow: "2", normal: "1", fast: "0.4",
};
export function applyAnimSpeed(speed: AnimSpeed) {
  document.documentElement.style.setProperty("--anim", ANIM_MAP[speed]);
}

export function applyTheme(theme: AppTheme) {
  const root = document.documentElement;
  // Accent
  root.style.setProperty("--accent-h", theme.accentH);
  root.style.setProperty("--accent-s", theme.accentS);
  root.style.setProperty("--accent-l", theme.accentL);
  // Backgrounds
  root.style.setProperty("--app-bg", theme.appBg);
  root.style.setProperty("--card-bg", theme.cardBg);
  root.style.setProperty("--surface-bg", theme.surfaceBg);
  root.style.setProperty("--sidebar-bg", theme.sidebarBg);
  // Borders
  root.style.setProperty("--border-color", theme.borderColor);
  root.style.setProperty("--border-strong", theme.borderStrong);
  // Text
  root.style.setProperty("--text-primary", theme.textPrimary);
  root.style.setProperty("--text-muted", theme.textMuted);
  // Aesthetics
  root.style.setProperty("--radius-card", theme.radiusCard);
  root.style.setProperty("--radius-sm", theme.radiusSm);
  root.style.setProperty("--glass-blur", theme.glassCards ? "16px" : "0px");
  root.style.setProperty("--noise-opacity", theme.noiseOverlay ? "0.04" : "0");
  // Preset extras
  root.style.setProperty("--card-shadow", theme.cardShadow);
  root.style.setProperty("--accent-glow", theme.accentGlow);
  root.style.setProperty("--scanline-opacity", String(theme.scanlineOpacity));
  root.style.setProperty("--bg-gradient", theme.bgGradient ?? "none");
  root.style.setProperty("--sidebar-accent-line", theme.sidebarAccentLine ? "3px" : "0px");

  // NeonBorders: si activo, usa accentGlow como box-shadow en borders
  root.style.setProperty(
    "--border-glow",
    theme.neonBorders
      ? `0 0 6px hsl(${theme.accentH} ${theme.accentS} ${theme.accentL} / 0.5)`
      : "none"
  );
  root.style.setProperty("--font-family", theme.fontMono
    ? "'Cascadia Code', 'Fira Mono', 'JetBrains Mono', 'Consolas', monospace"
    : "inherit"
  );
  // Apply theme id as data attribute for CSS overrides
  document.documentElement.setAttribute("data-theme", theme.id);

  // Re-apply wallpaper state (it may override --app-bg)
  const wallpaper = useAppearanceStore.getState().wallpaper;
  applyWallpaperCSS(wallpaper, theme);
}

export function applyWallpaperCSS(wallpaper: WallpaperConfig, theme: AppTheme) {
  const root = document.documentElement;
  if (wallpaper.enabled && wallpaper.path) {
    root.setAttribute("data-wallpaper", "active");
    root.style.setProperty("--app-bg", "transparent");
  } else {
    root.removeAttribute("data-wallpaper");
    root.style.setProperty("--app-bg", theme.appBg);
  }
}

// Paleta de acentos — colores en formato hex
const ACCENT_MAP: Record<string, { h: string; s: string; l: string }> = {
  red: { h: "0", s: "72%", l: "51%" },
  violet: { h: "262", s: "83%", l: "58%" },
  blue: { h: "217", s: "91%", l: "60%" },
  emerald: { h: "160", s: "84%", l: "39%" },
  amber: { h: "43", s: "96%", l: "56%" },
  pink: { h: "330", s: "81%", l: "60%" },
};
export function applyAccentColor(color: AccentColor) {
  const root = document.documentElement;
  if (color in ACCENT_MAP) {
    const { h, s, l } = ACCENT_MAP[color];
    root.style.setProperty("--accent-h", h);
    root.style.setProperty("--accent-s", s);
    root.style.setProperty("--accent-l", l);
  } else if (color.startsWith("#")) {
    // Custom hex → convert to HSL (simplified, for the plan include a hex2hsl helper)
    const [h, s, l] = hexToHsl(color);
    root.style.setProperty("--accent-h", String(h));
    root.style.setProperty("--accent-s", `${s}%`);
    root.style.setProperty("--accent-l", `${l}%`);
  }
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
    : max === g ? ((b - r) / d + 2) / 6
      : ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function applySidebarWidth(w: SidebarWidth) {
  const widthMap: Record<SidebarWidth, string> = {
    narrow: "3.5rem",  // w-14 icon-only
    normal: "14rem",   // w-56 actual
    wide: "18rem",   // w-72
  };
  document.documentElement.style.setProperty("--sidebar-width", widthMap[w]);
}

const BG_MAP: Record<BgStyle, string> = {
  "zinc-950": "#09090b",
  "black": "#000000",
  "zinc-900": "#18181b",
};
export function applyBgStyle(bg: BgStyle) {
  document.documentElement.style.setProperty("--app-bg", BG_MAP[bg]);
}

/** Aplica la escala al elemento raíz usando CSS transform en lugar de zoom */
export function applyUiScale(scale: UiScale) {
  const root = document.getElementById("root");
  if (!root) return;

  if (scale === 1.0) {
    // Restaurar valores por defecto
    root.style.transform = "";
    root.style.transformOrigin = "";
    root.style.width = "";
    root.style.height = "";
    root.style.overflow = "";
    return;
  }

  const invScale = 1 / scale;
  // Expandir el root para compensar la escala visual
  root.style.transformOrigin = "top left";
  root.style.transform = `scale(${scale})`;
  root.style.width = `${invScale * 100}%`;
  root.style.height = `${invScale * 100}%`;
  root.style.overflow = "hidden";
}
/**
 * Appearance store — ajustes de personalización visual de la app.
 * Persiste en localStorage.
 */
import { create } from "zustand";

export type ItemSize = "compact" | "normal" | "large";
export type UiScale = 0.8 | 0.9 | 1.0 | 1.1 | 1.2;
export type SidebarWidth = "narrow" | "normal" | "wide";
export type FontSize     = "small"  | "normal" | "large";
export type AnimSpeed    = "off"    | "slow"   | "normal" | "fast";
export type AccentColor  = "red" | "violet" | "blue" | "emerald" | "amber" | "pink" | string;
export type BgStyle      = "zinc-950" | "black" | "zinc-900";
export type DefaultView  = "grid" | "list";

export interface AppearanceState {
  shopItemSize:      ItemSize;
  inventoryItemSize: ItemSize;
  uiScale:           UiScale;
  showTagsInGrid:  boolean;
  showTypeIcons:   boolean;
  sidebarWidth:    SidebarWidth;
  fontSize:        FontSize;
  animSpeed:       AnimSpeed;
  accentColor:     AccentColor;
  bgStyle:         BgStyle;
  defaultView:     DefaultView;

  setShopItemSize:      (size: ItemSize) => void;
  setInventoryItemSize: (size: ItemSize) => void;
  setUiScale:           (scale: UiScale) => void;
  setShowTagsInGrid:    (v: boolean)     => void;
  setShowTypeIcons:     (v: boolean)     => void;
  setSidebarWidth: (v: SidebarWidth)  => void;
  setFontSize:     (v: FontSize)      => void;
  setAnimSpeed:    (v: AnimSpeed)     => void;
  setAccentColor:  (v: AccentColor)   => void;
  setBgStyle:      (v: BgStyle)       => void;
  setDefaultView:  (v: DefaultView)   => void;
}

const STORAGE_KEY = "app:appearance";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        shopItemSize:      parsed.shopItemSize      ?? "normal",
        inventoryItemSize: parsed.inventoryItemSize ?? "normal",
        uiScale:           parsed.uiScale           ?? 1.0,
        showTagsInGrid:    parsed.showTagsInGrid    ?? false,
        showTypeIcons:     parsed.showTypeIcons     ?? true,
        sidebarWidth: parsed.sidebarWidth ?? "normal",
        fontSize:     parsed.fontSize     ?? "normal",
        animSpeed:    parsed.animSpeed    ?? "normal",
        accentColor:  parsed.accentColor  ?? "red",
        bgStyle:      parsed.bgStyle      ?? "zinc-950",
        defaultView:  parsed.defaultView  ?? "grid",
      };
    }
  } catch {}
  return { shopItemSize: "normal", inventoryItemSize: "normal", uiScale: 1.0,
           showTagsInGrid: false, showTypeIcons: true };
}

function save(state: Partial<AppearanceState>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  ...load(),

  setShopItemSize: (shopItemSize) => {
    set({ shopItemSize });
    save({ ...get(), shopItemSize });
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
  setFontSize:     (fontSize)     => { set({ fontSize });     save({ ...get(), fontSize });     applyFontSize(fontSize);         },
  setAnimSpeed:    (animSpeed)    => { set({ animSpeed });    save({ ...get(), animSpeed });    applyAnimSpeed(animSpeed);       },
  setAccentColor:  (accentColor)  => { set({ accentColor });  save({ ...get(), accentColor });  applyAccentColor(accentColor);   },
  setBgStyle:      (bgStyle)      => { set({ bgStyle });      save({ ...get(), bgStyle });      applyBgStyle(bgStyle);           },
  setDefaultView:  (defaultView)  => { set({ defaultView });  save({ ...get(), defaultView });  },
}));

// src/store/appearanceStore.ts — al final del archivo

const FONT_MAP: Record<FontSize, string> = {
  small: "13px", normal: "14px", large: "15px",
};
export function applyFontSize(size: FontSize) {
  document.documentElement.style.setProperty("--base-font-size", FONT_MAP[size]);
}

const ANIM_MAP: Record<AnimSpeed, string> = {
  off: "0.0001s", slow: "2", normal: "1", fast: "0.4",
};
export function applyAnimSpeed(speed: AnimSpeed) {
  document.documentElement.style.setProperty("--anim", ANIM_MAP[speed]);
}

// Paleta de acentos — colores en formato hex
const ACCENT_MAP: Record<string, { h: string; s: string; l: string }> = {
  red:     { h: "0",   s: "72%", l: "51%" },
  violet:  { h: "262", s: "83%", l: "58%" },
  blue:    { h: "217", s: "91%", l: "60%" },
  emerald: { h: "160", s: "84%", l: "39%" },
  amber:   { h: "43",  s: "96%", l: "56%" },
  pink:    { h: "330", s: "81%", l: "60%" },
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
          :             ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function applySidebarWidth(w: SidebarWidth) {
  const widthMap: Record<SidebarWidth, string> = {
    narrow: "3.5rem",  // w-14 icon-only
    normal: "14rem",   // w-56 actual
    wide:   "18rem",   // w-72
  };
  document.documentElement.style.setProperty("--sidebar-width", widthMap[w]);
}

const BG_MAP: Record<BgStyle, string> = {
  "zinc-950": "#09090b",
  "black":    "#000000",
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
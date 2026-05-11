/**
 * Appearance store — ajustes de personalización visual de la app.
 * Persiste en localStorage.
 */
import { create } from "zustand";

export type ItemSize = "compact" | "normal" | "large";
export type UiScale = 0.8 | 0.9 | 1.0 | 1.1 | 1.2;

export interface AppearanceState {
  shopItemSize:      ItemSize;
  inventoryItemSize: ItemSize;
  uiScale:           UiScale;
  showTagsInGrid:  boolean;
  showTypeIcons:   boolean;

  setShopItemSize:      (size: ItemSize) => void;
  setInventoryItemSize: (size: ItemSize) => void;
  setUiScale:           (scale: UiScale) => void;
  setShowTagsInGrid:    (v: boolean)     => void;
  setShowTypeIcons:     (v: boolean)     => void;
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
}));

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
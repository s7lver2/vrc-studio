import { create } from "zustand";

export type Section = "projects" | "packages" | "shop" | "inventory" | "settings";

// ── Awesome Animations setting ─────────────────────────────────────────────────
const ANIM_KEY = "app:awesomeAnimations";
function loadAnimLevel(): number {
  try { const v = Number(localStorage.getItem(ANIM_KEY)); return isNaN(v) ? 0 : Math.min(2, Math.max(0, v)); } catch { return 0; }
}
function saveAnimLevel(v: number) { try { localStorage.setItem(ANIM_KEY, String(v)); } catch {} }

interface AppState {
  activeSection: Section;
  isLoading: boolean;
  loadingMessage: string | null;
  awesomeAnimations: number; // 0 = off, 1 = subtle, 2 = full

  setActiveSection: (section: Section) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setAwesomeAnimations: (level: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "projects",
  isLoading: false,
  loadingMessage: null,
  awesomeAnimations: loadAnimLevel(),

  setActiveSection: (section) => set({ activeSection: section }),
  setLoading: (loading, message) =>
    set({ isLoading: loading, loadingMessage: loading ? (message ?? null) : null }),
  setAwesomeAnimations: (level) => {
    saveAnimLevel(level);
    set({ awesomeAnimations: level });
  },
}));
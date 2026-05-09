import { create } from "zustand";
import type { Project } from "@/lib/tauri";

export type Section = "projects" | "packages" | "shop" | "inventory" | "settings" | "workspace" | "logs";

// ── Awesome Animations setting ─────────────────────────────────────────────────
const ANIM_KEY = "app:awesomeAnimations";
function loadAnimLevel(): number {
  try { const v = Number(localStorage.getItem(ANIM_KEY)); return isNaN(v) ? 0 : Math.min(2, Math.max(0, v)); } catch { return 0; }
}
function saveAnimLevel(v: number) { try { localStorage.setItem(ANIM_KEY, String(v)); } catch {} }

// ── Riperstore experimental flag ───────────────────────────────────────────────
const RIPERSTORE_KEY = "app:riperstoreExperimental";
export function loadRiperstoreExperimental(): boolean {
  try { return localStorage.getItem(RIPERSTORE_KEY) === "true"; } catch { return false; }
}
function saveRiperstoreExperimental(v: boolean) { try { localStorage.setItem(RIPERSTORE_KEY, String(v)); } catch {} }

interface AppState {
  activeSection: Section;
  isLoading: boolean;
  loadingMessage: string | null;
  awesomeAnimations: number; // 0 = off, 1 = subtle, 2 = full
  riperstoreExperimental: boolean;
  workspaceProject: Project | null;
  selectedProject: Project | null;

  setActiveSection: (section: Section) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setAwesomeAnimations: (level: number) => void;
  setRiperstoreExperimental: (enabled: boolean) => void;
  openWorkspace: (project: Project) => void;
  closeWorkspace: () => void;
  setSelectedProject: (project: Project | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "projects",
  isLoading: false,
  loadingMessage: null,
  awesomeAnimations: loadAnimLevel(),
  riperstoreExperimental: loadRiperstoreExperimental(),
  workspaceProject: null,
  selectedProject: null,

  setActiveSection: (section) => set({ activeSection: section }),
  setLoading: (loading, message) =>
    set({ isLoading: loading, loadingMessage: loading ? (message ?? null) : null }),
  setAwesomeAnimations: (level) => {
    saveAnimLevel(level);
    set({ awesomeAnimations: level });
  },
  setRiperstoreExperimental: (enabled) => {
    saveRiperstoreExperimental(enabled);
    set({ riperstoreExperimental: enabled });
  },
  openWorkspace: (project) => set({ activeSection: "workspace", workspaceProject: project }),
  closeWorkspace: () => set({ activeSection: "projects", workspaceProject: null }),
  setSelectedProject: (project) => set({ selectedProject: project }),
}));
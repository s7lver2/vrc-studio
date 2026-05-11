import { create } from "zustand";
import type { Project } from "@/lib/tauri";
import { isUntrustedSourcesUnlocked, lockUntrustedSources } from "@/hooks/useUntrustedSources";

export type Section = "projects" | "packages" | "shop" | "inventory" | "tracker" | "settings" | "workspace" | "logs" | "sandbox";

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
  riperstoreExperimental: boolean;
  workspaceProject: Project | null;
  selectedProject: Project | null;
  untrustedSourcesUnlocked: boolean;
  

  setActiveSection: (section: Section) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setRiperstoreExperimental: (enabled: boolean) => void;
  openWorkspace: (project: Project) => void;
  closeWorkspace: () => void;
  setSelectedProject: (project: Project | null) => void;
  setUntrustedSourcesUnlocked: (unlocked: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "projects",
  isLoading: false,
  loadingMessage: null,
  riperstoreExperimental: loadRiperstoreExperimental(),
  workspaceProject: null,
  selectedProject: null,
  untrustedSourcesUnlocked: isUntrustedSourcesUnlocked(),

  setActiveSection: (section) => set({ activeSection: section }),
  setLoading: (loading, message) =>
    set({ isLoading: loading, loadingMessage: loading ? (message ?? null) : null }),
  setRiperstoreExperimental: (enabled) => {
    saveRiperstoreExperimental(enabled);
    set({ riperstoreExperimental: enabled });
  },
  openWorkspace: (project) => set({ activeSection: "workspace", workspaceProject: project }),
  closeWorkspace: () => set({ activeSection: "projects", workspaceProject: null }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  setUntrustedSourcesUnlocked: (unlocked) => {
    if (!unlocked) {
      lockUntrustedSources();
      // Desactivar riperstore si se revoca el acceso
      saveRiperstoreExperimental(false);
      set({ untrustedSourcesUnlocked: false, riperstoreExperimental: false });
    } else {
      set({ untrustedSourcesUnlocked: true });
    }
  },
}));
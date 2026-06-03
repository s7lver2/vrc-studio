import { create } from "zustand";
import {
  BoothDepEntry,
  tauriBoothDepsRead,
  tauriBoothDepsCheckModifications,
} from "../lib/tauri";

interface BoothDepsStore {
  /** Dependencies for the currently loaded project */
  deps: BoothDepEntry[];
  /** Deps that still need to be resolved (not yet downloaded) */
  pending: string[]; // source_ids
  resolving: boolean;
  projectPath: string | null;

  /** Load deps from disk for a given project path */
  loadDeps: (projectPath: string) => Promise<void>;
  /** Check which deps have been locally modified */
  checkModifications: () => Promise<string[]>;
  /** Mark a dep as resolved (removes from pending list) */
  resolveDep: (sourceId: string) => void;
  /** Set the pending list (called after clone + dep detection) */
  setPending: (sourceIds: string[]) => void;
  /** Clear everything (e.g. when project changes) */
  reset: () => void;
}

export const useBoothDepsStore = create<BoothDepsStore>((set, get) => ({
  deps: [],
  pending: [],
  resolving: false,
  projectPath: null,

  loadDeps: async (projectPath: string) => {
    try {
      const deps = await tauriBoothDepsRead(projectPath);
      set({ deps, projectPath });
    } catch (e) {
      console.error("Failed to load booth-deps:", e);
    }
  },

  checkModifications: async () => {
    const { projectPath } = get();
    if (!projectPath) return [];
    try {
      const modified = await tauriBoothDepsCheckModifications(projectPath);
      // Reload deps to reflect updated `modified` flags
      const deps = await tauriBoothDepsRead(projectPath);
      set({ deps });
      return modified;
    } catch (e) {
      console.error("Failed to check modifications:", e);
      return [];
    }
  },

  resolveDep: (sourceId: string) => {
    set((s) => ({ pending: s.pending.filter((id) => id !== sourceId) }));
  },

  setPending: (sourceIds: string[]) => {
    set({ pending: sourceIds });
  },

  reset: () => set({ deps: [], pending: [], resolving: false, projectPath: null }),
}));

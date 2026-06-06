// src/store/toolsStore.ts
import { create } from "zustand";
import {
  InstalledTool,
  ToolRegistryEntry,
  tauriToolsList,
  tauriToolsFetchRegistry,
  tauriToolsInstall,
  tauriToolsUninstall,
} from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";

export interface InstallProgressEvent {
  id: string;
  progress: number; // 0.0 – 1.0
  step: string;
}

interface ToolsState {
  installed: InstalledTool[];
  registry: ToolRegistryEntry[];
  registryLoading: boolean;
  // installingId → progress (0–1)
  installing: Record<string, number>;
  installingStep: Record<string, string>;

  load: () => Promise<void>;
  fetchRegistry: () => Promise<void>;
  install: (entry: ToolRegistryEntry) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

export const useToolsStore = create<ToolsState>((set, get) => {
  // Listen for install progress events from Tauri backend
  listen<InstallProgressEvent>("tools://install-progress", ({ payload }) => {
    set((s) => ({
      installing: { ...s.installing, [payload.id]: payload.progress },
      installingStep: { ...s.installingStep, [payload.id]: payload.step },
    }));
  });

  return {
    installed: [],
    registry: [],
    registryLoading: false,
    installing: {},
    installingStep: {},

    load: async () => {
      try {
        const installed = await tauriToolsList();
        set({ installed });
      } catch (e) {
        console.error("tools load error:", e);
      }
    },

    fetchRegistry: async () => {
      set({ registryLoading: true });
      try {
        const registry = await tauriToolsFetchRegistry();
        set({ registry });
      } catch (e) {
        console.error("tools registry fetch error:", e);
      } finally {
        set({ registryLoading: false });
      }
    },

    install: async (entry) => {
      set((s) => ({
        installing: { ...s.installing, [entry.id]: 0 },
        installingStep: { ...s.installingStep, [entry.id]: "Iniciando…" },
      }));
      try {
        const tool = await tauriToolsInstall(entry);
        set((s) => ({
          installed: [tool, ...s.installed.filter((t) => t.id !== tool.id)],
          installing: Object.fromEntries(
            Object.entries(s.installing).filter(([k]) => k !== entry.id)
          ),
          installingStep: Object.fromEntries(
            Object.entries(s.installingStep).filter(([k]) => k !== entry.id)
          ),
        }));
      } catch (e) {
        console.error("tools install error:", e);
        set((s) => ({
          installing: Object.fromEntries(
            Object.entries(s.installing).filter(([k]) => k !== entry.id)
          ),
          installingStep: Object.fromEntries(
            Object.entries(s.installingStep).filter(([k]) => k !== entry.id)
          ),
        }));
        throw e;
      }
    },

    uninstall: async (id) => {
      await tauriToolsUninstall(id);
      set((s) => ({ installed: s.installed.filter((t) => t.id !== id) }));
    },
  };
});

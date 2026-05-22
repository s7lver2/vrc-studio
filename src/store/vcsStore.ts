import { create } from "zustand";
import type { GitStatus, CommitEntry, BranchInfo } from "@/types/vcs";
import { vcs } from "@/lib/tauri";

interface VcsState {
  status: GitStatus | null;
  log: CommitEntry[];
  branches: BranchInfo[];
  isLoading: boolean;
  error: string | null;
  activeProjectPath: string | null;
  branchColors: Record<string, string>;

  loadStatus: (projectPath: string) => Promise<void>;
  loadLog: (projectPath: string) => Promise<void>;
  loadBranches: (projectPath: string) => Promise<void>;
  commit: (projectPath: string, message: string) => Promise<void>;
  createBranch: (projectPath: string, name: string) => Promise<void>;
  switchBranch: (projectPath: string, name: string) => Promise<void>;
  clear: () => void;
  setBranchColor: (branchName: string, color: string) => void;
}

export const useVcsStore = create<VcsState>((set, get) => ({
  status: null,
  log: [],
  branches: [],
  isLoading: false,
  error: null,
  activeProjectPath: null,

  loadStatus: async (projectPath) => {
    set({ isLoading: true, error: null, activeProjectPath: projectPath });
    try {
      const status = await vcs.getStatus(projectPath);
      set({ status });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ isLoading: false });
    }
  },

  loadLog: async (projectPath) => {
    try {
      const log = await vcs.getLog(projectPath, 50);
      set({ log });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadBranches: async (projectPath) => {
    try {
      const branches = await vcs.listBranches(projectPath);
      set({ branches });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  commit: async (projectPath, message) => {
    set({ isLoading: true, error: null });
    try {
      await vcs.commit(projectPath, message);
      await get().loadStatus(projectPath);
      await get().loadLog(projectPath);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  createBranch: async (projectPath, name) => {
    await vcs.createBranch(projectPath, name);
    await get().loadBranches(projectPath);
  },

  switchBranch: async (projectPath, name) => {
    await vcs.switchBranch(projectPath, name);
    await get().loadBranches(projectPath);
    await get().loadStatus(projectPath);
  },

  clear: () =>
    set({ status: null, log: [], branches: [], error: null, activeProjectPath: null }),
  branchColors: {},
setBranchColor: (branchName, color) =>
  set((s) => ({ branchColors: { ...s.branchColors, [branchName]: color } })),
}));
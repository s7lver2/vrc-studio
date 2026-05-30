import { create } from "zustand";
import type { Project } from "@/lib/tauri";
import { isGetStartedDone, resetGetStarted } from "@/components/GetStarted";

export type Section = "projects" | "packages" | "shop" | "inventory" | "tracker" | "settings" | "workspace" | "logs" | "creators" | "git";

interface AppState {
  activeSection: Section;
  isLoading: boolean;
  loadingMessage: string | null;
  workspaceProject: Project | null;
  selectedProject: Project | null;
  showGetStarted: boolean;
  showAdultContent: boolean;

  discordRpcEnabled: boolean;
  discordAppId: string;
  setDiscordRpcEnabled: (v: boolean) => void;
  setDiscordAppId: (v: string) => void;
  setShowAdultContent: (v: boolean) => void;
  setActiveSection: (section: Section) => void;
  setLoading: (loading: boolean, message?: string) => void;
  openWorkspace: (project: Project) => void;
  closeWorkspace: () => void;
  setSelectedProject: (project: Project | null) => void;
  openGetStarted: () => void;
  closeGetStarted: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "projects",
  isLoading: false,
  showAdultContent: false,
  loadingMessage: null,
  workspaceProject: null,
  selectedProject: null,
  showGetStarted: !isGetStartedDone(),

  discordRpcEnabled: (() => {
    try { return localStorage.getItem("discord_rpc_enabled") === "true"; }
    catch { return false; }
  })(),
  discordAppId: (() => {
    try { return localStorage.getItem("discord_app_id") ?? ""; }
    catch { return ""; }
  })(),
  setDiscordRpcEnabled: (v) => {
    set({ discordRpcEnabled: v });
    try { localStorage.setItem("discord_rpc_enabled", String(v)); } catch {}
  },
  setDiscordAppId: (v) => {
    set({ discordAppId: v });
    try { localStorage.setItem("discord_app_id", v); } catch {}
  },
  setActiveSection: (section) => set({ activeSection: section }),
  setLoading: (loading, message) =>
    set({ isLoading: loading, loadingMessage: loading ? (message ?? null) : null }),
  openWorkspace: (project) => set({ activeSection: "workspace", workspaceProject: project }),
  closeWorkspace: () => set({ activeSection: "projects", workspaceProject: null }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  openGetStarted: () => {
    resetGetStarted();
    set({ showGetStarted: true });
  },
  closeGetStarted: () => set({ showGetStarted: false }),
  setShowAdultContent: (v) => set({ showAdultContent: v }),
}));
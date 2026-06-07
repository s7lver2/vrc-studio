import { create } from "zustand";
import type { Project } from "@/lib/tauri";
import type { DiscordUserInfo } from "@/lib/tauri";
import { isGetStartedDone, resetGetStarted } from "@/components/GetStarted";

export type Section = "projects" | "packages" | "shop" | "inventory" | "tracker" | "settings" | "workspace" | "logs" | "creators" | "git" | "tools";

interface AppState {
  activeSection: Section;
  isLoading: boolean;
  loadingMessage: string | null;
  workspaceProject: Project | null;
  selectedProject: Project | null;
  showGetStarted: boolean;
  showAdultContent: boolean;

  discordRpcEnabled: boolean;
  /** Populated after successful Discord OAuth. Null = not connected. */
  discordUser: DiscordUserInfo | null;
  /** Persisted to localStorage. Used for silent reauth on next launch. */
  discordAccessToken: string | null;

  setDiscordRpcEnabled: (v: boolean) => void;
  setDiscordUser: (u: DiscordUserInfo | null) => void;
  setDiscordAccessToken: (t: string | null) => void;
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
  discordUser: null,
  discordAccessToken: (() => {
    try { return localStorage.getItem("discord_access_token") ?? null; }
    catch { return null; }
  })(),

  setDiscordRpcEnabled: (v) => {
    set({ discordRpcEnabled: v });
    try { localStorage.setItem("discord_rpc_enabled", String(v)); } catch {}
  },
  setDiscordUser: (u) => set({ discordUser: u }),
  setDiscordAccessToken: (t) => {
    set({ discordAccessToken: t });
    try {
      if (t) { localStorage.setItem("discord_access_token", t); }
      else { localStorage.removeItem("discord_access_token"); }
    } catch {}
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

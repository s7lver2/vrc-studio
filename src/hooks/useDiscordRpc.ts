import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/app";
import { tauriDiscordRpcUpdate, tauriDiscordRpcClear } from "@/lib/tauri";

const SECTION_LABELS: Record<string, string> = {
  projects: "Proyectos",
  shop: "Tienda",
  inventory: "Inventario",
  settings: "Ajustes",
  workspace: "Workspace",
  packages: "Paquetes",
  tracker: "Tracker",
  git: "Git",
  logs: "Logs",
  creators: "Creadores",
};

export function useDiscordRpc(enabled: boolean) {
  const activeSection = useAppStore((s) => s.activeSection);
  const workspaceProject = useAppStore((s) => s.workspaceProject);
  const sessionStartRef = useRef<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!enabled) {
      tauriDiscordRpcClear().catch(() => {});
      return;
    }

    const activity = {
      project_name: workspaceProject?.name ?? null,
      section: SECTION_LABELS[activeSection] ?? activeSection,
      github_url: null,
      unity_open: false,
      session_start_ts: sessionStartRef.current,
    };

    tauriDiscordRpcUpdate(activity).catch((e) => {
      console.warn("[discord-rpc] update failed:", e);
    });
  }, [enabled, activeSection, workspaceProject]);

  useEffect(() => {
    return () => {
      if (enabled) tauriDiscordRpcClear().catch(() => {});
    };
  }, []);
}

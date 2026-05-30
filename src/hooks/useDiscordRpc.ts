import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/app";
import { useProjectsStore } from "@/store/projects";
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
  const openProjectIds = useProjectsStore((s) => s.openProjectIds);
  const sessionStartRef = useRef<number>(Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!enabled) {
      tauriDiscordRpcClear().catch(() => {});
      return;
    }

    const unityOpen = workspaceProject != null && openProjectIds.has(workspaceProject.id);

    const activity = {
      project_name: workspaceProject?.name ?? null,
      section: SECTION_LABELS[activeSection] ?? activeSection,
      github_url: null,
      unity_open: unityOpen,
      session_start_ts: sessionStartRef.current,
    };

    tauriDiscordRpcUpdate(activity).catch((e) => {
      console.warn("[discord-rpc] update failed:", e);
    });
  }, [enabled, activeSection, workspaceProject, openProjectIds]);

  useEffect(() => {
    return () => {
      if (enabled) tauriDiscordRpcClear().catch(() => {});
    };
  }, []);
}

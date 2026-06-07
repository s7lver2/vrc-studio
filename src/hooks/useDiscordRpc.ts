import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/store/app";
import { useProjectsStore } from "@/store/projects";
import {
  tauriDiscordRpcUpdate,
  tauriDiscordRpcUpdateWithCover,
  tauriDiscordRpcClear,
  tauriGetRunningUnityProjects,
} from "@/lib/tauri";

const UNITY_POLL_INTERVAL_MS = 8000;

export function useDiscordRpc(enabled: boolean) {
  const activeSection = useAppStore((s) => s.activeSection);
  const workspaceProject = useAppStore((s) => s.workspaceProject);
  const projects = useProjectsStore((s) => s.projects);
  const openProjectIds = useProjectsStore((s) => s.openProjectIds);
  const markProjectOpen = useProjectsStore((s) => s.markProjectOpen);
  const sessionStartRef = useRef<number>(Math.floor(Date.now() / 1000));

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // ── Polling: detect Unity processes and sync openProjectIds ─────────────
  useEffect(() => {
    if (!enabled) return;

    const poll = async () => {
      try {
        const running = await tauriGetRunningUnityProjects();
        for (const r of running) {
          const normalized = r.project_path.replace(/\\/g, "/");
          const match = projects.find((p) => p.path.replace(/\\/g, "/") === normalized);
          if (match) markProjectOpen(match.id);
        }
      } catch {
        // Unity not running or polling failed — silently ignore
      }
    };

    poll();
    const interval = setInterval(poll, UNITY_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled, projects, markProjectOpen]);

  // ── Push activity to Discord ─────────────────────────────────────────────
  const pushActivity = useCallback(async () => {
    if (!enabledRef.current) {
      tauriDiscordRpcClear().catch(() => {});
      return;
    }

    const activeProject =
      workspaceProject ??
      (openProjectIds.size > 0
        ? projects.find((p) => openProjectIds.has(p.id)) ?? null
        : null);

    const isInProject =
      (activeSection === "workspace" && workspaceProject != null) ||
      (activeProject != null && openProjectIds.has(activeProject.id));

    const unityOpen = isInProject && activeProject != null && openProjectIds.has(activeProject.id);

    let details: string;
    if (isInProject && activeProject) {
      details = activeProject.name;
    } else if (activeSection === "shop") {
      details = "Browsing the Shop";
    } else if (activeSection === "inventory") {
      details = "Browsing Inventory";
    } else if (activeSection === "projects") {
      details = "Browsing Projects";
    } else if (activeSection === "settings") {
      details = "In Settings";
    } else if (activeSection === "packages") {
      details = "Managing Packages";
    } else if (activeSection === "tracker") {
      details = "In Tracker";
    } else if (activeSection === "logs") {
      details = "Viewing Logs";
    } else {
      details = activeSection;
    }

    const state = isInProject
      ? (unityOpen ? "Unity open" : "Unity closed")
      : "VRC Studio";

    const coverPath = activeProject?.cover_image_path ?? null;
    const isCoverHttpUrl = coverPath?.startsWith("https://") || coverPath?.startsWith("http://");
    const isLocalCover = isInProject && !!coverPath && !isCoverHttpUrl;

    // For https covers, use directly.
    // For local covers, send to the backend which will upload/cache as Discord asset.
    // No cover → default "vrcstudio" asset key.
    const large_image = (isInProject && isCoverHttpUrl) ? coverPath! : "vrcstudio";
    const large_text = isInProject && activeProject ? activeProject.name : "VRC Studio";

    const activity = {
      project_name: isInProject && activeProject ? activeProject.name : null,
      project_cover_image: isInProject && coverPath ? coverPath : null,
      section: state,
      details,
      github_url: null,
      unity_open: unityOpen,
      session_start_ts: sessionStartRef.current,
      large_image_key: large_image,
      large_image_text: large_text,
    };

    if (isLocalCover) {
      // Use the backend command that handles local→Discord asset upload
      tauriDiscordRpcUpdateWithCover(activity).catch((e) => {
        console.warn("[discord-rpc] update-with-cover failed:", e);
        // Fallback to regular update with default logo
        tauriDiscordRpcUpdate({ ...activity, large_image_key: "vrcstudio", project_cover_image: null })
          .catch(() => {});
      });
    } else {
      tauriDiscordRpcUpdate(activity).catch((e) => {
        console.warn("[discord-rpc] update failed:", e);
      });
    }
  }, [enabled, activeSection, workspaceProject, openProjectIds, projects]);

  useEffect(() => {
    pushActivity();
  }, [pushActivity]);

  useEffect(() => {
    return () => {
      if (enabledRef.current) tauriDiscordRpcClear().catch(() => {});
    };
  }, []);
}
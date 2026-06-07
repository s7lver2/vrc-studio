// src/hooks/useEmbeddedSdk.ts
//
// Provides the same SDK surface as the iframe bridge, but for embedded
// (non-iframe) tool components that live in the main React tree.
//
// Interactive calls (selectProject, selectScene, selectAvatar) are
// routed through the `onInteractive` callback, which opens the same
// SdkPickerModals used by the iframe bridge.
// Non-interactive calls (getScenes, getAvatars) hit Tauri directly.

import { useCallback } from "react";
import {
  tauriToolsScanScenes,
  tauriToolsScanAvatars,
  SceneFile,
  AvatarDescriptor,
} from "../lib/tauri";
import { useProjectsStore } from "../store/projects";

export interface SdkProject {
  path: string;
  name: string;
  unity_version: string;
}

export interface EmbeddedSdkCallbacks {
  /** List all registered Unity projects from the store */
  getProjects(): Promise<SdkProject[]>;

  /**
   * Open the native project picker and return the selected project,
   * or null if the user cancels.
   */
  selectProject(): Promise<SdkProject | null>;

  /** Scan a Unity project for .unity scene files */
  getScenes(projectPath: string): Promise<SceneFile[]>;

  /**
   * Open the native scene picker for a given project.
   * Returns selected scene or null if cancelled.
   */
  selectScene(projectPath: string): Promise<SceneFile | null>;

  /** Parse a scene file and return all GameObjects with VRC_AvatarDescriptor */
  getAvatars(projectPath: string, scenePath: string): Promise<AvatarDescriptor[]>;

  /**
   * Open the native avatar picker for a given scene.
   * Returns selected avatar or null if cancelled.
   */
  selectAvatar(
    projectPath: string,
    scenePath: string
  ): Promise<AvatarDescriptor | null>;
}

/**
 * Hook for embedded tool components to access the VRC Studio SDK.
 *
 * The `onInteractive` callback is provided by ToolRunner and connects
 * to the same SdkPickerModals used by the iframe bridge. It returns
 * a Promise that resolves with the user's selection (or null if cancelled).
 *
 * @param onInteractive - Callback to open a picker modal for a given SDK method
 */
export function useEmbeddedSdk(
  onInteractive: (
    method: string,
    args: Record<string, unknown>
  ) => Promise<unknown>
): EmbeddedSdkCallbacks {
  const projects = useProjectsStore((s) => s.projects);

  const getProjects = useCallback((): Promise<SdkProject[]> => {
    return Promise.resolve(
      projects.map((p) => ({
        path: p.unity_path,
        name: p.name,
        unity_version: p.unity_version ?? "",
      }))
    );
  }, [projects]);

  const selectProject = useCallback((): Promise<SdkProject | null> => {
    return onInteractive("selectProject", {}) as Promise<SdkProject | null>;
  }, [onInteractive]);

  const getScenes = useCallback(
    (projectPath: string): Promise<SceneFile[]> => {
      return tauriToolsScanScenes(projectPath);
    },
    []
  );

  const selectScene = useCallback(
    (projectPath: string): Promise<SceneFile | null> => {
      return onInteractive("selectScene", { projectPath }) as Promise<SceneFile | null>;
    },
    [onInteractive]
  );

  const getAvatars = useCallback(
    (projectPath: string, scenePath: string): Promise<AvatarDescriptor[]> => {
      return tauriToolsScanAvatars(projectPath, scenePath);
    },
    []
  );

  const selectAvatar = useCallback(
    (projectPath: string, scenePath: string): Promise<AvatarDescriptor | null> => {
      return onInteractive("selectAvatar", {
        projectPath,
        scenePath,
      }) as Promise<AvatarDescriptor | null>;
    },
    [onInteractive]
  );

  return {
    getProjects,
    selectProject,
    getScenes,
    selectScene,
    getAvatars,
    selectAvatar,
  };
}
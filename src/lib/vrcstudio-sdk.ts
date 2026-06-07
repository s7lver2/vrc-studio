// src/lib/vrcstudio-sdk.ts
//
// VRC Studio SDK — type contracts.
//
// FRONTEND TOOLS (ui.js bundles loaded in iframes) get a `window.vrcstudio`
// object of type `VrcStudioSdk` injected by the parent app.
//
// SIDECAR BINARIES get `sdk_url` and `sdk_token` in the IPC request. They
// can call the same methods by hitting:
//   POST http://127.0.0.1:{port}/sdk/{method}
//   Header: Authorization: Bearer {sdk_token}
//   Body: JSON payload matching the method's args type

// ── Shared data types ─────────────────────────────────────────────────────

export interface SdkProject {
  /** Absolute path to the Unity project root */
  path: string;
  name: string;
  unity_version: string;
}

export interface SdkScene {
  /** Relative to project root, e.g. "Assets/Scenes/Main.unity" */
  path: string;
  name: string;
}

export interface SdkAvatar {
  name: string;
  file_id: string;
}

export interface SdkInventoryItem {
  id: number;
  name: string;
  category: string;
  booth_item_id: string | null;
  installed_path: string | null;
  image_url: string | null;
}

export interface SdkNotifyOptions {
  type?: "info" | "success" | "warning" | "error";
  duration?: number; // milliseconds, default 4000
}

export interface SdkFilePickerOptions {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
}

export interface SdkFileEntry {
  name: string;
  /** Path relative to the browser root */
  path: string;
  is_dir: boolean;
  extension: string | null;
  size_bytes: number | null;
}

// ── SDK surface ───────────────────────────────────────────────────────────

/**
 * The `window.vrcstudio` global available inside tool iframes.
 * All methods return Promises. Methods that require user interaction
 * show native VRC Studio picker UI in the parent app.
 */
export interface VrcStudioSdk {
  // ── Project ──────────────────────────────────────────────────────────
  /** List all registered Unity projects */
  getProjects(): Promise<SdkProject[]>;

  /**
   * Open the native project picker and return the selected project,
   * or null if the user cancels.
   */
  selectProject(): Promise<SdkProject | null>;

  /**
   * Open a project in Unity (triggers "Open in Unity" for that project).
   */
  openProject(projectPath: string): Promise<void>;

  // ── Scene ─────────────────────────────────────────────────────────────
  /** Scan a Unity project for .unity scene files */
  getScenes(projectPath: string): Promise<SdkScene[]>;

  /**
   * Open the native scene picker for a given project.
   * Returns selected scene or null if cancelled.
   */
  selectScene(projectPath: string): Promise<SdkScene | null>;

  // ── Avatar ────────────────────────────────────────────────────────────
  /** Parse a scene file and return all GameObjects with VRC_AvatarDescriptor */
  getAvatars(projectPath: string, scenePath: string): Promise<SdkAvatar[]>;

  /**
   * Open the native avatar picker for a given scene.
   * Returns selected avatar or null if cancelled.
   */
  selectAvatar(
    projectPath: string,
    scenePath: string
  ): Promise<SdkAvatar | null>;

  // ── Inventory ─────────────────────────────────────────────────────────
  /** List inventory items, optionally filtered by category */
  getInventoryItems(filter?: { category?: string; search?: string }): Promise<SdkInventoryItem[]>;

  /**
   * Open the native inventory picker.
   * Returns selected item or null if cancelled.
   */
  selectInventoryItem(filter?: {
    category?: string;
    title?: string;
  }): Promise<SdkInventoryItem | null>;

  /**
   * Trigger the VRC Studio import flow for a specific inventory item
   * (same as clicking "Import" on the item card).
   */
  importInventoryItem(itemId: number): Promise<void>;

  // ── File system ───────────────────────────────────────────────────────
  /** Open the OS file picker. Returns selected path(s) or null. */
  pickFile(options?: SdkFilePickerOptions): Promise<string | string[] | null>;

  /** Open the OS folder picker. Returns selected path or null. */
  pickFolder(title?: string): Promise<string | null>;

  // ── Import ────────────────────────────────────────────────────────────────
  /**
   * Open the "Import package" picker (Scan drive / Local file / From URL).
   * Resolves when the user dismisses the modal.
   */
  importPackage(opts?: { title?: string }): Promise<void>;

  // ── File browser ──────────────────────────────────────────────────────
  /** Open a visual file browser rooted at a Unity project. Returns selected absolute path or null. */
  browseProjectFiles(projectPath: string): Promise<string | null>;

  /** Open a visual file browser rooted at an inventory item's installed path. Returns selected absolute path or null. */
  browseInventoryItemFiles(itemId: number): Promise<string | null>;

  /** Return the file tree of a project directory without opening any UI. */
  getProjectFiles(projectPath: string, filter?: { extensions?: string[] }): Promise<SdkFileEntry[]>;

  // ── Sidecar ───────────────────────────────────────────────────────────────
  /**
   * Run this tool's own sidecar binary with the given args.
   * The parent app calls tools_run_sidecar(toolId, args) and resolves with the result.
   */
  runSidecar(args: Record<string, unknown>): Promise<unknown>;

  // ── UI helpers ────────────────────────────────────────────────────────
  /** Show a toast notification in the VRC Studio window */
  notify(message: string, options?: SdkNotifyOptions): void;

  /**
   * Report analysis progress back to VRC Studio.
   * Shows progress in the tool card / runner header (0.0 – 1.0).
   */
  setProgress(progress: number, label?: string): void;
}
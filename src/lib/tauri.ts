import { invoke } from "@tauri-apps/api/core";
import type { PrefabScene } from "@/types/prefab";

// ── Smoke test ────────────────────────────────────────────────
export async function tauriPing(msg: string): Promise<string> {
  return invoke<string>("ping", { msg });
}

// ── Types ──────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  path: string;
  unity_version: string;
  unity_type: "standard" | "custom";
  avatar_base_id: string | null;
  shader: "liltoon" | "poiyomi" | null;
  vcs_enabled: boolean;
  last_screenshot: string | null;
  is_compressed: boolean;
}

export interface UnityInstallation {
  version: string;
  path: string;
  is_custom: boolean;
}

export interface VpmPackage {
  id: string;
  versions: Record<string, VpmPackageVersion>;
}

export interface VpmPackageSample {
  display_name: string;
  description: string;
  path: string;
}

export interface VpmPackageVersion {
  name: string;
  display_name: string;
  version: string;
  unity: string;
  description: string | null;
  url: string;
  dependencies: Record<string, string>;
  // Extra optional VPM fields
  changelogUrl?: string | null;
  documentationUrl?: string | null;
  licensesUrl?: string | null;
  samples?: VpmPackageSample[];
}

export interface CreateProjectRequest {
  name: string;
  destination_dir: string;
  unity_version: string;
  unity_path: string;
  unity_type: "standard" | "custom";
  avatar_base_id: string | null;
  shader: "liltoon" | "poiyomi" | null;
  vcs_enabled: boolean;
  vpm_packages: string[];
  custom_package_ids: string[];
}

export interface CreateProjectProgress {
  progress: number;
  message: string;
  done: boolean;
  error: string | null;
}

// ── Packages ───────────────────────────────────────────────────

export interface CustomPackage {
  id: string;
  name: string;
  display_name: string;
  version: string;
  description: string | null;
  json_path: string;
  zip_path: string | null;
  created_at: string;
  updated_at: string;
  asset_ids: string[];
}

export interface CreatePackagePayload {
  name: string;
  display_name: string;
  version: string;
  description: string;
  asset_ids: string[];
}

// ── Inventory ──────────────────────────────────────────────────

export interface InventoryItem {
  id: string;
  name: string;
  author: string | null;
  source: "booth" | "riperstore" | "local";
  source_id: string | null;
  local_path: string;
  thumbnail_url: string | null;
  download_date: string;
  size_bytes: number | null;
  tags: string[];
  is_compressed: boolean;
  // v2
  display_name: string | null;
  custom_cover_path: string | null;
  sort_order: number | null;
  product_images: string[];
  custom_images: string[];
  folder_id: string | null;
}

// ── Commands ────────────────────────────────────────────────────

export const tauriListProjects = (): Promise<Project[]> =>
  invoke("list_projects");

export const tauriGetProject = (id: string): Promise<Project> =>
  invoke("get_project", { id });

export const tauriDeleteProject = (id: string, alsoDeleteFiles = false): Promise<void> =>
  invoke("delete_project", { id, alsoDeleteFiles });

export const tauriListUnityInstallations = (): Promise<UnityInstallation[]> =>
  invoke("list_unity_installations");

export const tauriFetchVpmIndex = (url?: string): Promise<VpmPackage[]> =>
  invoke("fetch_vpm_index", { url: url ?? null });

export const tauriCreateProject = (
  request: CreateProjectRequest
): Promise<Project> => invoke("create_project", { request });

export const tauriOpenProjectInUnity = (
  projectId: string,
  projectPath: string,
  unityPath: string
): Promise<void> => invoke("open_project_in_unity", { projectId, projectPath, unityPath });

export const tauriSaveProjectScreenshot = (
  id: string,
  screenshotPath: string,
): Promise<Project> => invoke("save_project_screenshot", { id, screenshotPath });

// ── Scan existing projects from disk ─────────────────────────────────────────

export interface ScannedProject {
  path: string;
  name: string;
  unity_version: string;
  already_imported: boolean;
}

export const tauriScanForProjects = (rootDir: string): Promise<ScannedProject[]> =>
  invoke("scan_for_projects", { rootDir });

export const tauriImportExistingProject = (
  path: string,
  name: string,
): Promise<Project> => invoke("import_existing_project", { path, name });

// ── Package commands ──────────────────────────────────────────

export const tauriListPackages = (): Promise<CustomPackage[]> =>
  invoke("list_packages");

export const tauriCreatePackage = (payload: CreatePackagePayload): Promise<CustomPackage> =>
  invoke("create_package", { payload });

export const tauriUpdatePackage = (id: string, payload: CreatePackagePayload): Promise<CustomPackage> =>
  invoke("update_package", { id, payload });

export const tauriDeletePackage = (id: string): Promise<void> =>
  invoke("delete_package", { id });

export const tauriBuildPackage = (id: string): Promise<CustomPackage> =>
  invoke("build_package", { id });

// ── Shop ───────────────────────────────────────────────────────────────────────

export interface ShopProductSource {
  source: "booth" | "riperstore";
  source_id: string;
  url: string;
}

/**
 * Structured download entry extracted from a Riperstore thread post.
 * `display_host` is parsed from link text (e.g. "🔗 Download (workupload.com)")
 * so the user knows the final destination without resolving the hidelinks redirect.
 */
export interface DownloadEntry {
  /** The raw download URL (may be a hidelinks/r/... redirect) */
  url: string;
  /** Real hostname extracted from link text or URL — e.g. "workupload.com", "mega.nz" */
  display_host: string | null;
  /** Password found in the immediate context of the link (e.g. "Password: ERPandUpvote") */
  password: string | null;
}

export interface ShopProduct {
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
  price_display: string;
  url: string;
  source: "booth" | "riperstore";
  /** Set when this product is available in multiple stores */
  extra_sources?: ShopProductSource[];
  /**
   * Booth item IDs found in the Riperstore thread content.
   * Only present on products with source === "riperstore".
   * 99.9% of Riperstore assets are also on Booth — use these IDs to
   * cross-reference with Booth results (better thumbnails, prices, etc.).
   */
  booth_ids?: string[];
  /**
   * Booth ID of the *avatar base* if the thread OP linked to boothplorer.com/avatar/XXXX.
   * This identifies the avatar (e.g. Airi = 6082686), not a clothing asset.
   * Only present on products with source === "riperstore".
   */
  avatar_booth_id?: string | null;
  /**
   * Structured download entries with host and password, extracted from all posts.
   * Only present on products with source === "riperstore" after a topic detail fetch.
   */
  downloads?: DownloadEntry[];
  /**
   * Canonical avatar names this asset is compatible with (e.g. ["Airi", "Manuka"]).
   * Extracted from thread title, tags, and post content.
   * Empty array = unknown compatibility.
   */
  supported_avatars?: string[];
}

/**
 * Result wrapper for a RipperStore search, including pagination info.
 * Matches the Rust `RiperstoreSearchResult` struct (snake_case field names).
 */
export interface RiperstoreSearchResult {
  products: ShopProduct[];
  page_count: number;
  current_page: number;
}

export const tauriSearchShop = (query: string, page: number): Promise<ShopProduct[]> =>
  invoke("search_shop", { query, page });

export interface BoothProductDetail {
  source_id: string;
  name: string;
  author: string;
  price_display: string;
  url: string;
  source: "booth";
  /** Imágenes en resolución original. Mínimo 1, normalmente 4-10. */
  images: string[];
  /** Descripción completa del producto con saltos de línea preservados. */
  description: string;
  /** Hasta 12 productos relacionados del mismo shop/página. */
  similar: ShopProduct[];
}

export const tauriGetBoothProductDetail = (
  source_id: string
): Promise<BoothProductDetail> =>
  invoke("get_booth_product_detail", { sourceId: source_id });

export const tauriStartDownload = (args: {
  source: string;
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
}): Promise<string> => invoke("start_download", {
  source:       args.source,
  sourceId:     args.source_id,
  name:         args.name,
  author:       args.author,
  thumbnailUrl: args.thumbnail_url,
});

export const tauriLinkAccount = (provider: string, token: string): Promise<void> =>
  invoke("link_account", { provider, token });

export const tauriUnlinkAccount = (provider: string): Promise<void> =>
  invoke("unlink_account", { provider });

export const tauriGetLinkedProviders = (): Promise<string[]> =>
  invoke("get_linked_providers");

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InventoryFolder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  custom_image_path: string | null;
}


export type DeleteMode =
  | "InventoryOnly"
  | "InventoryAndDisk"
  | "InventoryDiskAndProjects";

export const tauriListInventory = (): Promise<InventoryItem[]> =>
  invoke("list_inventory");

export const tauriDeleteInventoryItem = (
  item_id: string,
  mode: DeleteMode
): Promise<void> => invoke("delete_inventory_item", { itemId: item_id, mode });

export const tauriCreateInventoryFolder = (
  name: string,
  parent_id?: string
): Promise<string> =>
  invoke("create_inventory_folder", { name, parentId: parent_id ?? null });

export const tauriListInventoryFolders = (): Promise<InventoryFolder[]> =>
  invoke("list_inventory_folders");

export const tauriMoveItemToFolder = (
  item_id: string,
  folder_id: string | null
): Promise<void> => invoke("move_item_to_folder", { itemId: item_id, folderId: folder_id });

export const tauriTagInventoryItem = (
  item_id: string,
  tags: string[]
): Promise<void> => invoke("tag_inventory_item", { itemId: item_id, tags });

// ── Inventory — File system ───────────────────────────────────────────────────

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  extension: string | null;
  children: FileNode[] | null;
}

export interface UnityAsset {
  guid: string;
  asset_path: string;
  has_asset_file: boolean;
  size: number | null;
}

export const tauriGetFileTree = (path: string): Promise<FileNode> =>
  invoke("get_file_tree", { path });

export const tauriOpenItemLocation = (path: string): Promise<void> =>
  invoke("open_item_location", { path });

export const tauriReadUnitypackage = (path: string): Promise<UnityAsset[]> =>
  invoke("read_unitypackage", { path });

export const tauriSetItemProductImages = (
  item_id: string,
  images: string[]
): Promise<void> => invoke("set_item_product_images", { itemId: item_id, images });

export const tauriGetItemProductImages = (item_id: string): Promise<string[]> =>
  invoke("get_item_product_images", { itemId: item_id });

export const tauriImportLocalPackage = (args: {
  zip_path: string;
  name: string;
  author?: string;
  thumbnail_url?: string;
  booth_id?: string;
}): Promise<string> =>
  invoke("import_local_package", {
    zipPath: args.zip_path,
    name: args.name,
    author: args.author ?? null,
    thumbnailUrl: args.thumbnail_url ?? null,
    boothId: args.booth_id ?? null,
  });


export const tauriRipperIsAuthenticated = (): Promise<boolean> =>
  invoke("ripper_is_authenticated");

export const tauriOpenRipperAuth = (): Promise<void> =>
  invoke("open_ripper_auth");

export const tauriRipperLogout = (): Promise<void> =>
  invoke("ripper_logout");

/**
 * Searches Ripper.store via the authenticated WebView.
 * Returns a `RiperstoreSearchResult` with products + pagination info.
 * Use `.products` for the actual list; use `.page_count` to drive "Load More".
 */
export const tauriRipperSearch = (
  query: string,
  page: number
): Promise<RiperstoreSearchResult> =>
  invoke("ripper_search_via_webview", { query, page });

/**
 * Fires-and-forgets a category browse into the Ripper WebView.
 * Result arrives via the `ripper:category-result` Tauri event (not return value).
 * Useful for browsing Cat 38 (Clothes) without going through the search endpoint.
 */
export const tauriRipperBrowseCategory = (cid: number, page: number): Promise<void> =>
  invoke("ripper_browse_category", { cid, page });

export const tauriRipperGetTopicDetail = (
  source_id: string
): Promise<[string, string[], string[]]> =>
  invoke("ripper_get_topic_detail", { sourceId: source_id });

/**
 * Un link de descarga extraído del scrape profundo, con los avatares
 * mencionados en el post donde apareció el link.
 */
export interface DownloadLinkContext {
  url: string;
  /** Avatares canónicos detectados en el post que contenía este link. Vacío = desconocido. */
  avatars: string[];
}

/**
 * Deep-scrape a Riperstore topic across multiple pages (1..maxPages).
 * Returns links enriched with per-post avatar context.
 * Rust command: `ripper_scrape_deep`
 */
export const tauriRipperScrapeDeep = (
  source_id: string,
  max_pages: number = 5
): Promise<DownloadLinkContext[]> =>
  invoke("ripper_scrape_deep", { sourceId: source_id, maxPages: max_pages });

/**
 * Descarga directamente desde una URL arbitraria (para links de Riperstore ya resueltos).
 * Solo funciona con hosts de descarga directa (workupload, pixeldrain, gofile, catbox…).
 * Registra el archivo en el inventario y emite download://progress events.
 */
export const tauriDownloadDirectUrl = (args: {
  url: string;
  name: string;
  author: string;
  thumbnail_url: string;
  source_id: string;
}): Promise<string> =>
  invoke("download_direct_url", {
    url: args.url,
    name: args.name,
    author: args.author,
    thumbnailUrl: args.thumbnail_url,
    sourceId: args.source_id,
  });

/**
 * Resuelve un link `/hidelinks/r/<token>` de Riperstore a través del WebView
 * autenticado, evitando el reto de Cloudflare que bloquea el navegador del sistema.
 * Retorna la URL final real (workupload, mega, etc.) después de los redirects.
 */
export const tauriRipperResolveHidelink = (url: string): Promise<string> =>
  invoke("ripper_resolve_hidelink", { url });

// ── Booth.pm WebView auth ──────────────────────────────────────────────────────

export const tauriBoothIsAuthenticated = (): Promise<boolean> =>
  invoke("booth_is_authenticated");

export const tauriBoothOpenAuth = (): Promise<void> =>
  invoke("booth_open_auth");

export const tauriBoothLogout = (): Promise<void> =>
  invoke("booth_logout");

export const tauriBoothFetchPurchases = (): Promise<string[]> =>
  invoke("booth_fetch_purchases");

export const tauriBoothGetOwnedIds = (): Promise<string[]> =>
  invoke("booth_get_owned_ids");

// ── Compression ───────────────────────────────────────────────────────────────

export const tauriCompressItem = (item_id: string): Promise<void> =>
  invoke("compress_item", { itemId: item_id });

export const tauriDecompressItem = (item_id: string): Promise<void> =>
  invoke("decompress_item", { itemId: item_id });

export const tauriCompressProject = (project_id: string): Promise<void> =>
  invoke("compress_project", { projectId: project_id });

export const tauriDecompressProject = (project_id: string): Promise<void> =>
  invoke("decompress_project", { projectId: project_id });

// ── VCS ───────────────────────────────────────────────────────────────────────

import type { GitStatus, CommitEntry, BranchInfo, CommitDiffFile, FileDiff } from "@/types/vcs";

export const vcs = {
  getStatus: (projectPath: string) =>
    invoke<GitStatus>("get_vcs_status", { projectPath }),

  commit: (projectPath: string, message: string) =>
    invoke<string>("vcs_commit", { projectPath, message }),

  getLog: (projectPath: string, limit = 50) =>
    invoke<CommitEntry[]>("get_vcs_log", { projectPath, limit }),

  listBranches: (projectPath: string) =>
    invoke<BranchInfo[]>("list_vcs_branches", { projectPath }),

  createBranch: (projectPath: string, branchName: string) =>
    invoke<void>("create_vcs_branch", { projectPath, branchName }),

  switchBranch: (projectPath: string, branchName: string) =>
    invoke<void>("switch_vcs_branch", { projectPath, branchName }),

  addRemote: (projectPath: string, remoteUrl: string) =>
    invoke<void>("vcs_add_remote", { projectPath, remoteUrl }),

  push: (projectPath: string, token: string) =>
    invoke<void>("vcs_push", { projectPath, token }),

  pull: (projectPath: string, token: string) =>
    invoke<void>("vcs_pull", { projectPath, token }),

  /** Devuelve los archivos cambiados en un commit */
  getCommitDiff: (projectPath: string, commitSha: string) =>
    invoke<CommitDiffFile[]>("vcs_get_commit_diff", { projectPath, commitSha }),

  /** Devuelve el diff línea a línea de un archivo en un commit */
  getFileDiff: (projectPath: string, commitSha: string, filePath: string) =>
    invoke<FileDiff>("vcs_get_file_diff", { projectPath, commitSha, filePath }),

  /** Devuelve los archivos con conflictos de merge */
  getConflicts: (projectPath: string) =>
    invoke<ConflictFile[]>("vcs_get_conflicts", { projectPath }),

  /** Resuelve un conflicto: "ours" | "theirs" | "manual" */
  resolveConflict: (projectPath: string, filePath: string, strategy: ConflictStrategy) =>
    invoke<void>("vcs_resolve_conflict", { projectPath, filePath, strategy }),
};

// ── GitHub OAuth ──────────────────────────────────────────────────────────────
 
export interface GithubUserInfo {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}
 
export const github = {
  /** Paso 1: inicia el Device Flow. Devuelve user_code + URL para el usuario. */
  startDeviceAuth: () =>
    invoke<{ user_code: string; verification_uri: string; interval: number }>(
      "github_start_device_auth"
    ),
 
  /** Paso 2: polling — devuelve info del usuario cuando se complete la auth. */
  pollToken: () => invoke<GithubUserInfo>("github_poll_token"),
 
  /** Devuelve la info del usuario autenticado, o null si no hay sesión. */
  getUser: () => invoke<GithubUserInfo | null>("github_get_user"),
 
  /** Devuelve el access token para usarlo en push/pull. */
  getToken: () => invoke<string>("github_get_token"),
 
  /** Cierra la sesión eliminando el token del keyring. */
  logout: () => invoke<void>("github_logout"),
};

// ── Project VPM package management ────────────────────────────────────────────

export interface InstalledVpmPackage {
  name: string;
  version: string;
  is_locked: boolean;
}

export interface PkgProgress {
  package_id: string;
  step: string;
  progress: number;
  done: boolean;
  error: string | null;
}

export const tauriGetInstalledVpmPackages = (projectPath: string): Promise<InstalledVpmPackage[]> =>
  invoke("get_installed_vpm_packages", { projectPath });

export const tauriInstallVpmPackageToProject = (
  projectPath: string,
  packageId: string,
  version: string | null,
  repoUrls: string[],
): Promise<void> =>
  invoke("install_vpm_package_to_project", { projectPath, packageId, version, repoUrls });

export const tauriRemoveVpmPackageFromProject = (
  projectPath: string,
  packageId: string,
): Promise<void> =>
  invoke("remove_vpm_package_from_project", { projectPath, packageId });
// ── Journal ───────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export const journal = {
  list: (projectId: string) =>
    invoke<JournalEntry[]>("journal_list", { projectId }),
  create: (projectId: string, content: string) =>
    invoke<JournalEntry>("journal_create", { projectId, content }),
  update: (id: string, content: string) =>
    invoke<void>("journal_update", { id, content }),
  delete: (id: string) =>
    invoke<void>("journal_delete", { id }),
};

// ── Terminal ──────────────────────────────────────────────────────────────────

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export const terminal = {
  run: (projectPath: string, command: string) =>
    invoke<CommandOutput>("run_in_project", { projectPath, command }),
};
// ── VCS Conflicts ─────────────────────────────────────────────────────────────

export interface ConflictFile {
  path: string;
  ours_snippet: string;
  theirs_snippet: string;
}

export type ConflictStrategy = "ours" | "theirs" | "manual";

export const tauriGetVpmPackageFiles = (url: string): Promise<string[]> =>
    invoke("get_vpm_package_files", { url });

// ── Tracker ────────────────────────────────────────────────────────────────────

export type TrackerKind = "item" | "author";

export interface TrackerItem {
  id: string;
  kind: TrackerKind;
  // item fields
  booth_id: string | null;
  item_name: string | null;
  item_author: string | null;
  item_thumbnail_url: string | null;
  item_url: string | null;
  last_known_price: string | null;
  track_price_drops: boolean;
  track_availability: boolean;
  // author fields
  author_name: string | null;
  author_booth_shop_id: string | null;
  track_new_items: boolean;
  // common
  check_interval_minutes: number;
  last_checked_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TrackerEvent {
  id: string;
  tracker_item_id: string;
  event_type: "price_drop" | "price_change" | "back_in_stock" | "new_item";
  payload: string; // JSON string
  detected_at: string;
  is_read: boolean;
}

export interface CreateTrackerItemPayload {
  kind: TrackerKind;
  booth_id?: string;
  item_name?: string;
  item_author?: string;
  item_thumbnail_url?: string;
  item_url?: string;
  track_price_drops?: boolean;
  track_availability?: boolean;
  author_name?: string;
  author_booth_shop_id?: string;
  track_new_items?: boolean;
  check_interval_minutes?: number;
}

export interface UpdateTrackerItemPayload {
  track_price_drops?: boolean;
  track_availability?: boolean;
  track_new_items?: boolean;
  check_interval_minutes?: number;
  is_active?: boolean;
}

export const tauriTrackerList = (): Promise<TrackerItem[]> =>
  invoke("tracker_list");

export const tauriTrackerCreate = (
  payload: CreateTrackerItemPayload
): Promise<TrackerItem> =>
  invoke("tracker_create", { payload });

export const tauriTrackerUpdate = (
  id: string,
  payload: UpdateTrackerItemPayload
): Promise<TrackerItem> =>
  invoke("tracker_update", { id, payload });

export const tauriTrackerDelete = (id: string): Promise<void> =>
  invoke("tracker_delete", { id });

export const tauriTrackerListEvents = (args: {
  trackerItemId?: string;
  unreadOnly?: boolean;
}): Promise<TrackerEvent[]> =>
  invoke("tracker_list_events", {
    trackerItemId: args.trackerItemId ?? null,
    unreadOnly: args.unreadOnly ?? false,
  });

export const tauriTrackerMarkEventsRead = (ids: string[]): Promise<void> =>
  invoke("tracker_mark_events_read", { ids });

export const tauriTrackerUnreadCount = (): Promise<number> =>
  invoke("tracker_unread_count");

export interface ShopAuthor {
  name: string;
  product_count: number;
  sample_thumbnail: string;
  sample_products: ShopProduct[];
}

export async function tauriParsePrefab(path: string): Promise<PrefabScene> {
  return invoke<PrefabScene>("parse_prefab", { path });
}

export interface UpdateItemMetadataPayload {
  item_id: string;
  display_name?: string | null;
  tags?: string[];
}

export const tauriUpdateItemMetadata = (
  payload: UpdateItemMetadataPayload,
): Promise<void> => invoke("update_item_metadata", { payload });

export const tauriSetItemCustomCover = (
  item_id: string,
  source_path: string,
): Promise<string> => invoke("set_item_custom_cover", { itemId: item_id, sourcePath: source_path });

export const tauriReorderItems = (item_ids: string[]): Promise<void> =>
  invoke("reorder_items", { itemIds: item_ids });

export const tauriSetItemCustomImages = (
  item_id: string,
  source_paths: string[]
): Promise<string[]> =>
  invoke("set_item_custom_images", { itemId: item_id, sourcePaths: source_paths });

export const tauriUpdateFolder = (
  folder_id: string,
  opts: { name?: string; color?: string; image_source_path?: string; clear_image?: boolean }
): Promise<InventoryFolder> =>
  invoke("update_folder", {
    folderId: folder_id,
    name: opts.name ?? null,
    color: opts.color ?? null,
    imageSourcePath: opts.image_source_path ?? null,
    clearImage: opts.clear_image ?? false,
  });

export async function tauriDeleteInventoryFolder(folderId: string) {
  return await invoke("delete_inventory_folder", { folderId });
}

export async function tauriResetAllFolderAssignments(): Promise<void> {
  await invoke("reset_all_folder_assignments");
}
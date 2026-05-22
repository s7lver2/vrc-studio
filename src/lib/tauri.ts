import { invoke } from "@tauri-apps/api/core";
import type { PrefabScene } from "@/types/prefab";

// ── Smoke test ────────────────────────────────────────────────
export async function tauriPing(msg: string): Promise<string> {
  return invoke<string>("ping", { msg });
}

// ── Types ──────────────────────────────────────────────────────

export interface AppSettings {
  custom_assets_dir: string | null;
  unity_import_skip_dialog: boolean;
  unity_import_sequential: boolean;
  /** Segundos que se esperan a que Unity arranque. Por defecto 180, min 30, max 600. */
  unity_boot_wait_secs: number;

  /** Extra VPM repository URLs configured by the user. */
  extra_vpm_sources: string[];

  /** Si true, activa la caché en memoria de URLs de imágenes. Por defecto true. */
  image_cache_enabled: boolean;

  /** Número máximo de entradas en la caché. Rango 50–1000. Por defecto 300. */
  image_cache_max_count: number;
}

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
  unity_path: string;
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

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  html_url: string;
  private: boolean;
  description: string | null;
  updated_at: string | null;
  stargazers_count: number | null;
  topics: string[];
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
  display_name: string | null;
  custom_cover_path: string | null;
  sort_order: number | null;
  product_images: string[];
  custom_images: string[];
  folder_id: string | null;
}

export interface ImportProgressPayload {
  index: number;
  total: number;
  path: string;
  done: boolean;
}

export interface InventoryFolder {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  custom_image_path: string | null;
  custom_image_fill: "icon" | "grid" | null;
  sort_order?: number;
}

export type DeleteMode =
  | "InventoryOnly"
  | "InventoryAndDisk"
  | "InventoryDiskAndProjects";

// ── Commands ────────────────────────────────────────────────────

export const tauriListProjects = (): Promise<Project[]> =>
  invoke("list_projects");

export const tauriGetProject = (id: string): Promise<Project> =>
  invoke("get_project", { id });

export const tauriDeleteProject = (id: string, alsoDeleteFiles = false): Promise<void> =>
  invoke("delete_project", { id, alsoDeleteFiles });

export const tauriListUnityInstallations = (): Promise<UnityInstallation[]> =>
  invoke("list_unity_installations");

export const tauriFetchVpmIndex = (): Promise<VpmPackage[]> =>
  invoke("fetch_vpm_index");

export const tauriCreateProject = (request: CreateProjectRequest): Promise<Project> =>
  invoke("create_project", { request });

export const tauriGetRunningUnityProjects = (): Promise<RunningUnityProject[]> =>
  invoke("get_running_unity_projects");

/**
 * Dado un unity_version string (ej. "2022.3.22f1"), devuelve la ruta al
 * ejecutable Unity que coincide, o null si no se encuentra.
 */
export const tauriFindUnityForVersion = (version: string): Promise<string | null> =>
  invoke("find_unity_for_version", { version });

export const tauriOpenProjectInUnity = (projectId: string, projectPath: string, unityPath: string): Promise<void> =>
  invoke("open_project_in_unity", { projectId, projectPath, unityPath });

export const tauriSaveProjectScreenshot = (id: string, screenshotPath: string): Promise<Project> =>
  invoke("save_project_screenshot", { id, screenshotPath });

export interface ScannedProject {
  path: string;
  name: string;
  unity_version: string;
  already_imported: boolean;
}

export const tauriScanForProjects = (rootDir: string): Promise<ScannedProject[]> =>
  invoke("scan_for_projects", { rootDir });

export const tauriImportExistingProject = (path: string, name: string): Promise<Project> =>
  invoke("import_existing_project", { path, name });

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

// ── Shop ───────────────────────────────────────────────────────
export interface ShopProductSource {
  source: "booth" | "riperstore";
  source_id: string;
  url: string;
}

export interface DownloadEntry {
  url: string;
  display_host: string | null;
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
  extra_sources?: ShopProductSource[];
  booth_ids?: string[];
  avatar_booth_id?: string | null;
  downloads?: DownloadEntry[];
  supported_avatars?: string[];
}

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
  images: string[];
  description: string;
  similar: ShopProduct[];
}

export const tauriGetBoothProductDetail = (source_id: string): Promise<BoothProductDetail> =>
  invoke("get_booth_product_detail", { sourceId: source_id });

export const tauriStartDownload = (args: {
  source: string;
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
}): Promise<string> =>
  invoke("start_download", {
    source: args.source,
    sourceId: args.source_id,
    name: args.name,
    author: args.author,
    thumbnailUrl: args.thumbnail_url,
  });

/** Descarga un item GRATUITO de Booth sin autenticación. */
export const tauriBoothDownloadFreeItem = (args: {
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
}): Promise<string> =>
  invoke("booth_download_free_item", {
    sourceId: args.source_id,
    name: args.name,
    author: args.author,
    thumbnailUrl: args.thumbnail_url,
  });

export const tauriLinkAccount = (provider: string, token: string): Promise<void> =>
  invoke("link_account", { provider, token });

export const tauriUnlinkAccount = (provider: string): Promise<void> =>
  invoke("unlink_account", { provider });

export const tauriGetLinkedProviders = (): Promise<string[]> =>
  invoke("get_linked_providers");

// ── Inventory commands ─────────────────────────────────────────
export const tauriListInventory = (): Promise<InventoryItem[]> =>
  invoke("list_inventory");

export const tauriDeleteInventoryItem = (item_id: string, mode: DeleteMode): Promise<void> =>
  invoke("delete_inventory_item", { itemId: item_id, mode });

export const tauriCreateInventoryFolder = (name: string, parent_id?: string): Promise<string> =>
  invoke("create_inventory_folder", { name, parentId: parent_id ?? null });

export const tauriListInventoryFolders = (): Promise<InventoryFolder[]> =>
  invoke("list_inventory_folders");

export const tauriMoveItemToFolder = (item_id: string, folder_id: string | null): Promise<void> =>
  invoke("move_item_to_folder", { itemId: item_id, folderId: folder_id });

export const tauriTagInventoryItem = (item_id: string, tags: string[]): Promise<void> =>
  invoke("tag_inventory_item", { itemId: item_id, tags });

// ── Inventory file system ──────────────────────────────────────
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

export const tauriSetItemProductImages = (item_id: string, images: string[]): Promise<void> =>
  invoke("set_item_product_images", { itemId: item_id, images });

export const tauriGetItemProductImages = (item_id: string): Promise<string[]> =>
  invoke("get_item_product_images", { itemId: item_id });

export const tauriImportLocalPackage = (args: {
  zip_path: string;
  name: string;
  author?: string;
  thumbnail_url?: string;
  booth_id?: string;
  overwrite?: boolean;
  tags?: string[];
  detected_avatars?: string[];
}): Promise<string> =>
  invoke("import_local_package", {
    zipPath: args.zip_path,
    name: args.name,
    author: args.author ?? null,
    thumbnailUrl: args.thumbnail_url ?? null,
    boothId: args.booth_id ?? null,
    overwrite: args.overwrite ?? false,
    tags: args.tags ?? null,
    detectedAvatars: args.detected_avatars ?? null,
  });

export const tauriRipperIsAuthenticated = (): Promise<boolean> =>
  invoke("ripper_is_authenticated");

export const tauriOpenRipperAuth = (): Promise<void> =>
  invoke("open_ripper_auth");

export const tauriRipperLogout = (): Promise<void> =>
  invoke("ripper_logout");

export const tauriRipperSearch = (query: string, page: number): Promise<RiperstoreSearchResult> =>
  invoke("ripper_search_via_webview", { query, page });

export const tauriRipperBrowseCategory = (cid: number, page: number): Promise<void> =>
  invoke("ripper_browse_category", { cid, page });

export const tauriRipperGetTopicDetail = (source_id: string): Promise<[string, string[], string[]]> =>
  invoke("ripper_get_topic_detail", { sourceId: source_id });

export interface DownloadLinkContext {
  url: string;
  avatars: string[];
}

export const tauriRipperScrapeDeep = (source_id: string, max_pages = 5): Promise<DownloadLinkContext[]> =>
  invoke("ripper_scrape_deep", { sourceId: source_id, maxPages: max_pages });

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

export const tauriRipperResolveHidelink = (url: string): Promise<string> =>
  invoke("ripper_resolve_hidelink", { url });

// ── Booth.pm ──────────────────────────────────────────────────
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

// ── Compression ────────────────────────────────────────────────
export const tauriCompressItem = (item_id: string): Promise<void> =>
  invoke("compress_item", { itemId: item_id });

export const tauriDecompressItem = (item_id: string): Promise<void> =>
  invoke("decompress_item", { itemId: item_id });

export const tauriCompressProject = (project_id: string): Promise<void> =>
  invoke("compress_project", { projectId: project_id });

export const tauriDecompressProject = (project_id: string): Promise<void> =>
  invoke("decompress_project", { projectId: project_id });

// ── VCS ────────────────────────────────────────────────────────
import type { GitStatus, CommitEntry, BranchInfo, CommitDiffFile, FileDiff } from "@/types/vcs";

export const vcs = {
  getStatus: (projectPath: string) => invoke<GitStatus>("get_vcs_status", { projectPath }),
  commit: (projectPath: string, message: string) => invoke<string>("vcs_commit", { projectPath, message }),
  getLog: (projectPath: string, limit = 50) => invoke<CommitEntry[]>("get_vcs_log", { projectPath, limit }),
  listBranches: (projectPath: string) => invoke<BranchInfo[]>("list_vcs_branches", { projectPath }),
  createBranch: (projectPath: string, branchName: string) => invoke<void>("create_vcs_branch", { projectPath, branchName }),
  switchBranch: (projectPath: string, branchName: string) => invoke<void>("switch_vcs_branch", { projectPath, branchName }),
  addRemote: (projectPath: string, remoteUrl: string) => invoke<void>("vcs_add_remote", { projectPath, remoteUrl }),
  push: (projectPath: string, token: string) => invoke<void>("vcs_push", { projectPath, token }),
  pull: (projectPath: string, token: string) => invoke<void>("vcs_pull", { projectPath, token }),
  getCommitDiff: (projectPath: string, commitSha: string) => invoke<CommitDiffFile[]>("vcs_get_commit_diff", { projectPath, commitSha }),
  getFileDiff: (projectPath: string, commitSha: string, filePath: string) => invoke<FileDiff>("vcs_get_file_diff", { projectPath, commitSha, filePath }),
  getConflicts: (projectPath: string) => invoke<ConflictFile[]>("vcs_get_conflicts", { projectPath }),
  resolveConflict: (projectPath: string, filePath: string, strategy: ConflictStrategy) => invoke<void>("vcs_resolve_conflict", { projectPath, filePath, strategy }),
  createBranchFromCommit: (projectPath: string, branchName: string, commitSha: string) =>
    invoke<void>("create_vcs_branch_from_commit", { projectPath, branchName, commitSha }),
  listRepos: () => invoke<GithubRepo[]>("github_list_repos"),
  createRepo: (name: string, isPrivate: boolean, description: string) =>
    invoke<GithubRepo>("github_create_repo", { name, private: isPrivate, description }),
  mergeBranch: (projectPath: string, branchName: string) =>
    invoke<string>("vcs_merge_branch", { projectPath, branchName }),
  mergeBySha: (projectPath: string, commitSha: string) =>
    invoke<string>("vcs_merge_by_sha", { projectPath, commitSha }),
  deleteBranch: (projectPath: string, branchName: string) =>
    invoke<void>("vcs_delete_branch", { projectPath, branchName }),
  createBranchWithInit: (projectPath: string, branchName: string, fromCommitSha: string) =>
    invoke<string>("vcs_create_branch_with_init", { projectPath, branchName, fromCommitSha }),
  readGitignore: (projectPath: string) =>
    invoke<string>("vcs_read_gitignore", { projectPath }),
  writeGitignore: (projectPath: string, content: string) =>
    invoke<void>("vcs_write_gitignore", { projectPath, content }),
  getCommitFiles: (projectPath: string, commitSha: string) =>
    invoke<CommitDiffFile[]>("vcs_get_commit_files", { projectPath, commitSha }),
};

export interface ConflictFile {
  path: string;
  ours_snippet: string;
  theirs_snippet: string;
}
export type ConflictStrategy = "ours" | "theirs" | "manual";

// ── GitHub OAuth ──────────────────────────────────────────────
export interface GithubUserInfo {
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export const github = {
  startDeviceAuth: () => invoke<{ user_code: string; verification_uri: string; interval: number }>("github_start_device_auth"),
  pollToken: () => invoke<GithubUserInfo>("github_poll_token"),
  getUser: () => invoke<GithubUserInfo | null>("github_get_user"),
  getToken: () => invoke<string>("github_get_token"),
  logout: () => invoke<void>("github_logout"),
};

// ── Project packages ──────────────────────────────────────────
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

export const tauriInstallVpmPackageToProject = (projectPath: string, packageId: string, version: string | null, repoUrls: string[]): Promise<void> =>
  invoke("install_vpm_package_to_project", { projectPath, packageId, version, repoUrls });

export const tauriRemoveVpmPackageFromProject = (projectPath: string, packageId: string): Promise<void> =>
  invoke("remove_vpm_package_from_project", { projectPath, packageId });

// ── Journal ───────────────────────────────────────────────────
export interface JournalEntry {
  id: string;
  project_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export const journal = {
  list: (projectId: string) => invoke<JournalEntry[]>("journal_list", { projectId }),
  create: (projectId: string, content: string) => invoke<JournalEntry>("journal_create", { projectId, content }),
  update: (id: string, content: string) => invoke<void>("journal_update", { id, content }),
  delete: (id: string) => invoke<void>("journal_delete", { id }),
};

// ── Terminal ──────────────────────────────────────────────────
export interface CommandOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
}

export const terminal = {
  run: (projectPath: string, command: string) => invoke<CommandOutput>("run_in_project", { projectPath, command }),
};

export const tauriGetVpmPackageFiles = (url: string): Promise<string[]> =>
  invoke("get_vpm_package_files", { url });

// ── Tracker ───────────────────────────────────────────────────
export type TrackerKind = "item" | "author";

export interface TrackerItem {
  id: string;
  kind: TrackerKind;
  booth_id: string | null;
  item_name: string | null;
  item_author: string | null;
  item_thumbnail_url: string | null;
  item_url: string | null;
  last_known_price: string | null;
  track_price_drops: boolean;
  track_availability: boolean;
  author_name: string | null;
  author_booth_shop_id: string | null;
  track_new_items: boolean;
  check_interval_minutes: number;
  last_checked_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TrackerEvent {
  id: string;
  tracker_item_id: string;
  event_type: "price_drop" | "price_change" | "back_in_stock" | "new_item";
  payload: string;
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

export const tauriTrackerList = (): Promise<TrackerItem[]> => invoke("tracker_list");
export const tauriTrackerCreate = (payload: CreateTrackerItemPayload): Promise<TrackerItem> => invoke("tracker_create", { payload });
export const tauriTrackerUpdate = (id: string, payload: UpdateTrackerItemPayload): Promise<TrackerItem> => invoke("tracker_update", { id, payload });
export const tauriTrackerDelete = (id: string): Promise<void> => invoke("tracker_delete", { id });
export const tauriTrackerListEvents = (args: { trackerItemId?: string; unreadOnly?: boolean }): Promise<TrackerEvent[]> =>
  invoke("tracker_list_events", { trackerItemId: args.trackerItemId ?? null, unreadOnly: args.unreadOnly ?? false });
export const tauriTrackerMarkEventsRead = (ids: string[]): Promise<void> => invoke("tracker_mark_events_read", { ids });
export const tauriTrackerUnreadCount = (): Promise<number> => invoke("tracker_unread_count");

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

export const tauriUpdateItemMetadata = (payload: UpdateItemMetadataPayload): Promise<void> =>
  invoke("update_item_metadata", { payload });

export const tauriSetItemCustomCover = (item_id: string, source_path: string): Promise<string> =>
  invoke("set_item_custom_cover", { itemId: item_id, sourcePath: source_path });

export const tauriReorderItems = (item_ids: string[]): Promise<void> =>
  invoke("reorder_items", { itemIds: item_ids });

export const tauriSetItemCustomImages = (item_id: string, source_paths: string[]): Promise<string[]> =>
  invoke("set_item_custom_images", { itemId: item_id, sourcePaths: source_paths });

export const tauriUpdateFolder = (folder_id: string, opts: { name?: string; color?: string; image_source_path?: string; clear_image?: boolean; image_fill?: "icon" | "grid"; }): Promise<InventoryFolder> =>
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

// ── Backup & Restore ──────────────────────────────────────────
export const tauriExportDatabase = (): Promise<string> => invoke("export_database_data");
export const tauriImportDatabase = (json: string): Promise<void> => invoke("import_database_data", { json });

// ── Duplicate check ───────────────────────────────────────────
export const tauriCheckDuplicateItems = (name: string, zipPath?: string): Promise<{ exists: boolean; existing_item_ids: string[] }> =>
  invoke("check_duplicate_items", { name, zipPath: zipPath ?? null });

export const tauriTrackerRunNow = (id?: string): Promise<void> =>
  invoke("tracker_run_now", { id: id ?? null });

export interface ReclaimableFile {
  path: string;
  size_bytes: number;
  category: "source_art" | "blender" | "unity_cache" | "video" | "log";
  description: string;
  source_name: string;
  can_compress: boolean;
  is_directory: boolean;
}

export interface ScanReclaimableOptions {
  min_size_bytes?: number;
  include_unity_cache?: boolean;
  include_source_art?: boolean;
  include_blender?: boolean;
  include_logs?: boolean;
  include_videos?: boolean;
}

export interface DeleteReclaimableResult {
  deleted: number;
  freed_bytes: number;
  errors: string[];
}

export const tauriScanReclaimable = (
  searchPaths: string[],
  options?: ScanReclaimableOptions,
): Promise<ReclaimableFile[]> =>
  invoke("scan_reclaimable_files", { searchPaths, options: options ?? null });

export const tauriDeleteReclaimable = (
  paths: string[],
): Promise<DeleteReclaimableResult> =>
  invoke("delete_reclaimable_files", { paths });

// Add this near other command exports (e.g., after tauriListProjects)
export const tauriSetAppSettings = (settings: AppSettings): Promise<void> =>
  invoke("set_app_settings", { settings });

export const tauriGetAppSettings = (): Promise<AppSettings> =>
  invoke("get_app_settings");

export interface RunningUnityProject {
  pid: number;
  /** Ruta al proyecto Unity en ejecución (separadores normalizados a '/'). */
  project_path: string;
}

/**
 * Lanza Unity para el proyecto indicado si no está ya corriendo.
 * Retorna `true` si ya estaba corriendo (lockfile presente), `false` si se acaba de lanzar.
 * Fire-and-forget: no espera a que Unity cargue completamente.
 */
export const tauriLaunchUnityForProject = (
  projectPath: string,
  unityPath: string
): Promise<boolean> =>
  invoke("launch_unity_for_project", { projectPath, unityPath });

/**
 * Comprueba si Unity tiene abierto el proyecto en `projectPath`.
 * Usa el lockfile `Temp/UnityLockfile` como método primario.
 * Llamar periódicamente para saber cuándo Unity está listo.
 */
export const tauriCheckUnityRunning = (projectPath: string): Promise<boolean> =>
  invoke("check_unity_running", { projectPath });

/**
 * Importa una lista de `.unitypackage` en el Unity ya abierto.
 * Emite eventos `inventory:import_progress` conforme avanza.
 * Precondición: Unity debe estar corriendo (tauriCheckUnityRunning = true).
 */
export const tauriImportItemsInUnity = (
  projectPath: string,
  itemPaths: string[]
): Promise<void> =>
  invoke("import_items_in_unity", { projectPath, itemPaths });

export const tauriOpenSingleItemInUnity = (
  projectPath: string,
  itemPath: string,
): Promise<void> =>
  invoke("open_single_item_in_unity", { projectPath, itemPath });

export const tauriFocusUnityWindow = (projectPath: string): Promise<void> =>
  invoke("focus_unity_window", { projectPath: projectPath });

export const tauriReadVccRepos = (): Promise<string[]> =>
  invoke("read_vcc_repos");

/** Diagnostic: returns path + URLs for each config file checked. */
export const tauriDebugVccSources = (): Promise<[string, string[]][]> =>
  invoke("debug_vcc_sources");

/** Fetches packages from a single VPM repository URL. */
export const tauriFetchVpmRepo = (url: string): Promise<VpmPackage[]> =>
  invoke("fetch_vpm_repo", { url });

export const tauriDownloadToTemp = (url: string): Promise<string> =>
  invoke("download_to_temp", { url });

export const tauriBoothCaptureSessionCookie = (): Promise<boolean> =>
  invoke("booth_capture_session_cookie");

export const tauriReorderFolders = (orderedIds: string[]): Promise<void> =>
  invoke("reorder_folders", { orderedIds });


// ── Cart ──────────────────────────────────────────────────────────────────────
export interface CartItem {
  id: string;
  source: string;
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
  price_display: string;
  url: string;
  added_at: string;
}

export const tauriCartGetItems = () =>
  invoke<CartItem[]>("cart_get_items");

export const tauriCartAddItem = (item: {
  source: string; source_id: string; name: string; author: string;
  thumbnail_url: string; price_display: string; url: string;
}) => invoke<CartItem>("cart_add_item", item);

export const tauriCartRemoveItem = (source: string, source_id: string) =>
  invoke<void>("cart_remove_item", { source, source_id });

export const tauriCartClear = () =>
  invoke<void>("cart_clear");

export const tauriCartIsInCart = (source: string, source_id: string) =>
  invoke<boolean>("cart_is_in_cart", { source, source_id });

// ── Collections ───────────────────────────────────────────────────────────────
export interface Collection {
  id: string;
  name: string;
  cover_url: string;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  source: string;
  source_id: string;
  name: string;
  author: string;
  thumbnail_url: string;
  price_display: string;
  url: string;
  added_at: string;
}

export const tauriCollectionsList = () => invoke<Collection[]>("collections_list");
export const tauriCollectionCreate = (name: string) => invoke<Collection>("collection_create", { name });
export const tauriCollectionDelete = (collectionId: string) => invoke<void>("collection_delete", { collectionId });
export const tauriCollectionRename = (collectionId: string, name: string) => invoke<void>("collection_rename", { collectionId, name });
export const tauriCollectionSetCover = (collectionId: string, coverUrl: string) => invoke<void>("collection_set_cover", { collectionId, coverUrl });
export const tauriCollectionAddItem = (collectionId: string, item: {
  source: string; source_id: string; name: string; author: string;
  thumbnail_url: string; price_display: string; url: string;
}) => invoke<void>("collection_add_item", { collectionId, ...item });
export const tauriCollectionRemoveItem = (collectionId: string, source: string, source_id: string) =>
  invoke<void>("collection_remove_item", { collectionId, source, source_id });
export const tauriCollectionGetItems = (collectionId: string) =>
  invoke<CollectionItem[]>("collection_get_items", { collectionId });
export const tauriCollectionGetItemCollections = (source: string, source_id: string) =>
  invoke<string[]>("collection_get_item_collections", { source, source_id });
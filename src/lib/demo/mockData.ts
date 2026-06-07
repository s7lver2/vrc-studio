/**
 * Modo Expositor — Datos falsos para demostraciones y capturas de pantalla web.
 * Ningún archivo real es leído o escrito.
 *
 * Imágenes: se usan thumbnails reales de Booth.pm (items VRChat populares).
 * Se cargan de forma asíncrona en activateDemoMode(); si Booth no es accesible
 * se muestran los placeholders picsum como fallback.
 */

import type { Project, ProjectFolder, InventoryItem, InventoryFolder, TrackerItem, TrackerEvent } from "@/lib/tauri";
import { tauriGetBoothProductDetail } from "@/lib/tauri";
import type { CommitEntry, GitStatus } from "@/types/vcs";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fakeId(prefix: string, n: number) {
  return `demo-${prefix}-${String(n).padStart(4, "0")}`;
}

/** Genera una fecha Unix (segundos) n días antes de ahora. */
function daysAgo(n: number) {
  return Math.floor(Date.now() / 1000) - n * 86400;
}

function isoAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

// ─── Booth thumbnail loader ──────────────────────────────────────────────────

/**
 * Intentar obtener el thumbnail real de un item de Booth.pm.
 * Retorna null si falla (offline, CORS, item no existe, etc.).
 */
export async function fetchBoothThumbnail(boothId: string): Promise<string | null> {
  try {
    const detail = await tauriGetBoothProductDetail(boothId);
    return detail.images[0] ?? null;
  } catch {
    return null;
  }
}

// Fallback: picsum con semilla determinista
const FALLBACK = (seed: string) => `https://picsum.photos/seed/${seed}/400/400`;

// ─── Project Folders ────────────────────────────────────────────────────────

export const DEMO_PROJECT_FOLDERS: ProjectFolder[] = [
  { id: "demo-pfolder-0001", name: "Avatares Activos",  parent_id: null, color: "#8b5cf6", sort_order: 0, emoji: "✨", image: null },
  { id: "demo-pfolder-0002", name: "Builds de Evento",  parent_id: null, color: "#f59e0b", sort_order: 1, emoji: "🎪", image: null },
  { id: "demo-pfolder-0003", name: "Archivado",         parent_id: null, color: "#6b7280", sort_order: 2, emoji: "📦", image: null },
];

// ─── Projects ───────────────────────────────────────────────────────────────

export const DEMO_PROJECTS: Project[] = [
  // ── Sin carpeta (raíz) — 2 proyectos ────────────────────────────────────
  {
    id:               "demo-proj-0001",
    name:             "Yukimi — Recolor Pack v2",
    path:             "C:\\VRChat\\Projects\\Yukimi_Recolor_v2",
    unity_version:    "2022.3.22f1",
    unity_type:       "standard",
    avatar_base_id:   "com.vrchat.avatars",
    shader:           "liltoon",
    vcs_enabled:      true,
    last_screenshot:  null,
    cover_image_path: null,
    is_compressed:    false,
    unity_path:       "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.22f1\\Editor\\Unity.exe",
    folder_id:        null,
  },
  {
    id:               "demo-proj-0002",
    name:             "Kasumi — Spring 2025 Edition",
    path:             "C:\\VRChat\\Projects\\Kasumi_Spring2025",
    unity_version:    "2022.3.22f1",
    unity_type:       "standard",
    avatar_base_id:   "com.vrchat.avatars",
    shader:           "poiyomi",
    vcs_enabled:      true,
    last_screenshot:  null,
    cover_image_path: null,
    is_compressed:    false,
    unity_path:       "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.22f1\\Editor\\Unity.exe",
    folder_id:        null,
  },
  // ── En carpetas ──────────────────────────────────────────────────────────
  {
    id:               "demo-proj-0003",
    name:             "Nocturne Edit — Club Build",
    path:             "C:\\VRChat\\Projects\\Nocturne_ClubBuild",
    unity_version:    "2022.3.22f1",
    unity_type:       "standard",
    avatar_base_id:   "com.vrchat.avatars",
    shader:           "liltoon",
    vcs_enabled:      true,
    last_screenshot:  null,
    cover_image_path: null,
    is_compressed:    false,
    unity_path:       "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.22f1\\Editor\\Unity.exe",
    folder_id:        "demo-pfolder-0001",
  },
  {
    id:               "demo-proj-0004",
    name:             "Rindo — Festival Stage",
    path:             "C:\\VRChat\\Projects\\Rindo_FestivalStage",
    unity_version:    "2022.3.22f1",
    unity_type:       "standard",
    avatar_base_id:   "com.vrchat.avatars",
    shader:           "poiyomi",
    vcs_enabled:      true,
    last_screenshot:  null,
    cover_image_path: null,
    is_compressed:    false,
    unity_path:       "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.22f1\\Editor\\Unity.exe",
    folder_id:        "demo-pfolder-0002",
  },
  {
    id:               "demo-proj-0005",
    name:             "Festival Stage World",
    path:             "C:\\VRChat\\Projects\\FestivalStage_World",
    unity_version:    "2022.3.22f1",
    unity_type:       "custom",
    avatar_base_id:   null,
    shader:           null,
    vcs_enabled:      false,
    last_screenshot:  null,
    cover_image_path: null,
    is_compressed:    false,
    unity_path:       "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.22f1\\Editor\\Unity.exe",
    folder_id:        "demo-pfolder-0002",
  },
  {
    id:               "demo-proj-0006",
    name:             "Himeko Base — WIP",
    path:             "C:\\VRChat\\Projects\\Himeko_WIP",
    unity_version:    "2022.3.22f1",
    unity_type:       "standard",
    avatar_base_id:   "com.vrchat.avatars",
    shader:           "poiyomi",
    vcs_enabled:      true,
    last_screenshot:  null,
    cover_image_path: null,
    is_compressed:    true,
    unity_path:       "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.22f1\\Editor\\Unity.exe",
    folder_id:        "demo-pfolder-0001",
  },
];

// ─── Inventory Folders ──────────────────────────────────────────────────────

export const DEMO_INV_FOLDERS: InventoryFolder[] = [
  { id: "demo-ifolder-0001", name: "Avatares Base",     parent_id: null, color: "#8b5cf6", custom_image_path: null, custom_image_fill: null, sort_order: 0 },
  { id: "demo-ifolder-0002", name: "Ropa y Outfits",    parent_id: null, color: "#ec4899", custom_image_path: null, custom_image_fill: null, sort_order: 1 },
  { id: "demo-ifolder-0003", name: "Pelo y Accesorios", parent_id: null, color: "#3b82f6", custom_image_path: null, custom_image_fill: null, sort_order: 2 },
  { id: "demo-ifolder-0004", name: "Shaders y Tools",   parent_id: null, color: "#10b981", custom_image_path: null, custom_image_fill: null, sort_order: 3 },
  { id: "demo-ifolder-0005", name: "En Proceso",        parent_id: null, color: "#f59e0b", custom_image_path: null, custom_image_fill: null, sort_order: 4 },
];

// ─── Inventory Items ─────────────────────────────────────────────────────────
//
// booth_id → ID real del item en Booth.pm. Se usa para cargar el thumbnail
// real de forma asíncrona en activateDemoMode().
//
// Thumbnails iniciales: picsum (fallback) — se reemplazan por imágenes reales
// de Booth cuando la app está online.
//
// Items seleccionados: avatares y accesorios VRChat muy conocidos y estables
// en Booth, con IDs verificados públicamente.

export const DEMO_INV_ITEMS: InventoryItem[] = [
  // ── Avatares Base ────────────────────────────────────────────────────────
  {
    id: fakeId("item", 1), name: "karin_v2.0_base.zip",
    display_name: "Karin 2.0 (花梨)",
    author: "Lune",
    source: "booth", source_id: "3341768",   // booth.pm/ja/items/3341768
    local_path: "C:\\VRCStudio\\Inventory\\karin_v2.0_base.zip",
    thumbnail_url: FALLBACK("karin20"),
    download_date: isoAgo(45), size_bytes: 142_500_000,
    tags: ["avatar", "base", "liltoon-compatible"], is_compressed: false,
    custom_cover_path: null, sort_order: 0, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0001",
  },
  {
    id: fakeId("item", 2), name: "manuka_2.0.zip",
    display_name: "Manuka 2.0 (マヌカ)",
    author: "てのひらスタジオ",
    source: "booth", source_id: "5148012",   // booth.pm/ja/items/5148012
    local_path: "C:\\VRCStudio\\Inventory\\manuka_2.0.zip",
    thumbnail_url: FALLBACK("manuka20"),
    download_date: isoAgo(30), size_bytes: 118_000_000,
    tags: ["avatar", "base", "physbone"], is_compressed: false,
    custom_cover_path: null, sort_order: 1, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0001",
  },
  {
    id: fakeId("item", 3), name: "selestia_v1.0.zip",
    display_name: "Selestia (セレスティア)",
    author: "BOOTH SHOP",
    source: "booth", source_id: "4664949",   // booth.pm/ja/items/4664949
    local_path: "C:\\VRCStudio\\Inventory\\selestia_v1.0.zip",
    thumbnail_url: FALLBACK("selestia10"),
    download_date: isoAgo(60), size_bytes: 176_000_000,
    tags: ["avatar", "base", "poiyomi-ready"], is_compressed: false,
    custom_cover_path: null, sort_order: 2, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0001",
  },
  {
    id: fakeId("item", 4), name: "lime_avatar.zip",
    display_name: "Lime (ライム)",
    author: "みんてぃ",
    source: "booth", source_id: "3870979",   // booth.pm/ja/items/3870979
    local_path: "C:\\VRCStudio\\Inventory\\lime_avatar.zip",
    thumbnail_url: FALLBACK("limeavatar"),
    download_date: isoAgo(14), size_bytes: 210_000_000,
    tags: ["avatar", "base"], is_compressed: true,
    custom_cover_path: null, sort_order: 3, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0001",
  },
  // ── Ropa y Outfits ───────────────────────────────────────────────────────
  {
    id: fakeId("item", 5), name: "idol_stage_costume.zip",
    display_name: "Idol Stage Costume",
    author: "StellaWear",
    source: "booth", source_id: "5380927",   // popular VRChat outfit item
    local_path: "C:\\VRCStudio\\Inventory\\idol_stage_costume.zip",
    thumbnail_url: FALLBACK("idolstage"),
    download_date: isoAgo(8), size_bytes: 41_000_000,
    tags: ["clothing", "outfit", "multi-compatible"], is_compressed: false,
    custom_cover_path: null, sort_order: 0, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0002",
  },
  {
    id: fakeId("item", 6), name: "gothic_lolita_dress.zip",
    display_name: "Gothic Lolita Dress",
    author: "DarkStitch",
    source: "booth", source_id: "4519567",
    local_path: "C:\\VRCStudio\\Inventory\\gothic_lolita_dress.zip",
    thumbnail_url: FALLBACK("gothicloli"),
    download_date: isoAgo(35), size_bytes: 55_000_000,
    tags: ["clothing", "gothic", "lolita"], is_compressed: false,
    custom_cover_path: null, sort_order: 1, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0002",
  },
  {
    id: fakeId("item", 7), name: "summer_casual_set.zip",
    display_name: "Summer Casual Set",
    author: "HanaCloth",
    source: "booth", source_id: "4026667",
    local_path: "C:\\VRCStudio\\Inventory\\summer_casual_set.zip",
    thumbnail_url: FALLBACK("summercasual"),
    download_date: isoAgo(20), size_bytes: 28_000_000,
    tags: ["clothing", "casual", "yukimi"], is_compressed: false,
    custom_cover_path: null, sort_order: 2, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0002",
  },
  {
    id: fakeId("item", 8), name: "casual_hoodie_v2.zip",
    display_name: "Casual Hoodie v2",
    author: "NeonThreads",
    source: "local", source_id: null,
    local_path: "C:\\VRCStudio\\Inventory\\casual_hoodie_v2.zip",
    thumbnail_url: FALLBACK("casualhoodie"),
    download_date: isoAgo(50), size_bytes: 18_000_000,
    tags: ["clothing", "casual"], is_compressed: false,
    custom_cover_path: null, sort_order: 3, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0002",
  },
  // ── Pelo y Accesorios ────────────────────────────────────────────────────
  {
    id: fakeId("item", 9), name: "long_wavy_hair_pink.zip",
    display_name: "Long Wavy Hair — Pink",
    author: "HairLab",
    source: "booth", source_id: "4780935",
    local_path: "C:\\VRCStudio\\Inventory\\long_wavy_hair_pink.zip",
    thumbnail_url: FALLBACK("wavyhairpink"),
    download_date: isoAgo(12), size_bytes: 33_000_000,
    tags: ["hair", "dynamic-bone", "physbone"], is_compressed: false,
    custom_cover_path: null, sort_order: 0, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0003",
  },
  {
    id: fakeId("item", 10), name: "twin_tails_accessory_pack.zip",
    display_name: "Twin Tails Accessory Pack",
    author: "HairLab",
    source: "booth", source_id: "3960418",
    local_path: "C:\\VRCStudio\\Inventory\\twin_tails_accessory_pack.zip",
    thumbnail_url: FALLBACK("twintails"),
    download_date: isoAgo(25), size_bytes: 22_000_000,
    tags: ["hair", "accessories", "twin-tails"], is_compressed: false,
    custom_cover_path: null, sort_order: 1, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0003",
  },
  {
    id: fakeId("item", 11), name: "elf_ears_set.unitypackage",
    display_name: "Elf Ears Set",
    author: "FantasyProps",
    source: "booth", source_id: "2686962",
    local_path: "C:\\VRCStudio\\Inventory\\elf_ears_set.unitypackage",
    thumbnail_url: FALLBACK("elfears"),
    download_date: isoAgo(70), size_bytes: 8_500_000,
    tags: ["accessories", "ears", "fantasy"], is_compressed: false,
    custom_cover_path: null, sort_order: 2, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0003",
  },
  {
    id: fakeId("item", 12), name: "ribbon_headband_col.zip",
    display_name: "Ribbon Headband Collection",
    author: "PastelleAcc",
    source: "booth", source_id: "3612948",
    local_path: "C:\\VRCStudio\\Inventory\\ribbon_headband_col.zip",
    thumbnail_url: FALLBACK("ribbonheadband"),
    download_date: isoAgo(5), size_bytes: 11_000_000,
    tags: ["accessories", "ribbon", "cute"], is_compressed: false,
    custom_cover_path: null, sort_order: 3, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0003",
  },
  // ── Shaders y Tools ──────────────────────────────────────────────────────
  {
    id: fakeId("item", 13), name: "liltoon_1.9.1.zip",
    display_name: "lilToon 1.9.1",
    author: "lilxyzw",
    source: "local", source_id: null,
    local_path: "C:\\VRCStudio\\Inventory\\liltoon_1.9.1.zip",
    thumbnail_url: FALLBACK("liltoon19"),
    download_date: isoAgo(90), size_bytes: 5_200_000,
    tags: ["shader", "liltoon", "tool"], is_compressed: false,
    custom_cover_path: null, sort_order: 0, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0004",
  },
  {
    id: fakeId("item", 14), name: "poiyomi_9.0.57.zip",
    display_name: "Poiyomi Toon 9.0.57",
    author: "Poiyomi",
    source: "local", source_id: null,
    local_path: "C:\\VRCStudio\\Inventory\\poiyomi_9.0.57.zip",
    thumbnail_url: FALLBACK("poiyomi9"),
    download_date: isoAgo(30), size_bytes: 12_800_000,
    tags: ["shader", "poiyomi", "tool"], is_compressed: false,
    custom_cover_path: null, sort_order: 1, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0004",
  },
  {
    id: fakeId("item", 15), name: "gesture_manager_3.9.zip",
    display_name: "Gesture Manager 3.9",
    author: "BlackStartX",
    source: "local", source_id: null,
    local_path: "C:\\VRCStudio\\Inventory\\gesture_manager_3.9.zip",
    thumbnail_url: FALLBACK("gesturemanager"),
    download_date: isoAgo(45), size_bytes: 3_100_000,
    tags: ["tool", "gesture", "editor-tool"], is_compressed: false,
    custom_cover_path: null, sort_order: 2, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0004",
  },
  // ── En Proceso ───────────────────────────────────────────────────────────
  {
    id: fakeId("item", 16), name: "mystery_outfit_wip.zip",
    display_name: "Mystery Outfit (WIP)",
    author: "Anon",
    source: "local", source_id: null,
    local_path: "C:\\VRCStudio\\Inventory\\mystery_outfit_wip.zip",
    thumbnail_url: null,
    download_date: isoAgo(2), size_bytes: 7_400_000,
    tags: ["wip", "clothing"], is_compressed: false,
    custom_cover_path: null, sort_order: 0, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0005",
  },
  {
    id: fakeId("item", 17), name: "new_avatar_pack_extract.zip",
    display_name: "New Avatar Pack",
    author: null,
    source: "local", source_id: null,
    local_path: "C:\\VRCStudio\\Inventory\\new_avatar_pack_extract.zip",
    thumbnail_url: null,
    download_date: isoAgo(1), size_bytes: 89_000_000,
    tags: ["avatar", "wip"], is_compressed: false,
    custom_cover_path: null, sort_order: 1, product_images: [], custom_images: [],
    folder_id: "demo-ifolder-0005",
  },
  {
    id: fakeId("item", 18), name: "extra_props_bundle.zip",
    display_name: "Extra Props Bundle",
    author: "PropShop",
    source: "booth", source_id: "4149569",
    local_path: "C:\\VRCStudio\\Inventory\\extra_props_bundle.zip",
    thumbnail_url: FALLBACK("propsbundle"),
    download_date: isoAgo(55), size_bytes: 62_000_000,
    tags: ["props", "accessories"], is_compressed: true,
    custom_cover_path: null, sort_order: 2, product_images: [], custom_images: [],
    folder_id: null,
  },
];

// ─── Tracker Items ───────────────────────────────────────────────────────────

export const DEMO_TRACKER_ITEMS: TrackerItem[] = [
  {
    id: "demo-tracker-0001",
    kind: "item",
    booth_id: "3341768",
    item_name: "Karin 2.0 (花梨)",
    item_author: "Lune",
    item_thumbnail_url: FALLBACK("karin20"),
    item_url: "https://booth.pm/ja/items/3341768",
    last_known_price: "¥2,200",
    track_price_drops: true,
    track_availability: true,
    created_at: isoAgo(45),
    check_interval_minutes: 60,
    last_checked_at: isoAgo(0),
    is_active: true,
  },
  {
    id: "demo-tracker-0002",
    kind: "author",
    author_name: "てのひらスタジオ",
    author_booth_shop_id: "tenohira-studio",
    item_thumbnail_url: FALLBACK("manuka20"),
    track_new_items: true,
    created_at: isoAgo(30),
    check_interval_minutes: 120,
    last_checked_at: isoAgo(0),
    is_active: true,
  },
  {
    id: "demo-tracker-0003",
    kind: "keyword",
    search_keyword: "liltoon avatar vrchat",
    search_category: null,
    created_at: isoAgo(10),
    check_interval_minutes: 360,
    last_checked_at: isoAgo(0),
    is_active: true,
  },
];

// ─── Tracker Events ──────────────────────────────────────────────────────────

export const DEMO_TRACKER_EVENTS: TrackerEvent[] = [
  {
    id: "demo-evt-0001",
    tracker_item_id: "demo-tracker-0001",
    event_type: "price_drop",
    payload: JSON.stringify({ old_price: "¥3,800", new_price: "¥2,200", product_name: "Karin 2.0 (花梨)" }),
    detected_at: isoAgo(3),
    is_read: false,
  },
  {
    id: "demo-evt-0002",
    tracker_item_id: "demo-tracker-0001",
    event_type: "back_in_stock",
    payload: JSON.stringify({ product_name: "Karin 2.0 (花梨)", price: "¥3,800" }),
    detected_at: isoAgo(20),
    is_read: true,
  },
  {
    id: "demo-evt-0003",
    tracker_item_id: "demo-tracker-0002",
    event_type: "new_item",
    payload: JSON.stringify({
      id: "5200000",
      name: "Manuka 2.0 Summer DLC",
      price: "¥800",
      thumbnail: FALLBACK("manukadlc"),
      url: "https://booth.pm/ja/items/5200000",
    }),
    detected_at: isoAgo(5),
    is_read: false,
  },
  {
    id: "demo-evt-0004",
    tracker_item_id: "demo-tracker-0002",
    event_type: "new_item",
    payload: JSON.stringify({
      id: "5200001",
      name: "Manuka Gothic Outfit Pack",
      price: "¥1,500",
      thumbnail: FALLBACK("manukagothic"),
      url: "https://booth.pm/ja/items/5200001",
    }),
    detected_at: isoAgo(12),
    is_read: true,
  },
  {
    id: "demo-evt-0005",
    tracker_item_id: "demo-tracker-0003",
    event_type: "keyword_seen",
    payload: JSON.stringify({
      id: "4915830",
      name: "Yukimi 3.0 — liltoon Edition",
      price: "¥4,200",
      thumbnail: FALLBACK("yukimi30"),
      url: "https://booth.pm/ja/items/4915830",
    }),
    detected_at: isoAgo(1),
    is_read: false,
  },
  {
    id: "demo-evt-0006",
    tracker_item_id: "demo-tracker-0003",
    event_type: "keyword_seen",
    payload: JSON.stringify({
      id: "3808536",
      name: "Chiffon Base — liltoon compatible",
      price: "¥3,500",
      thumbnail: FALLBACK("chiffon"),
      url: "https://booth.pm/ja/items/3808536",
    }),
    detected_at: isoAgo(4),
    is_read: true,
  },
];

// ─── Git Data (per project) ──────────────────────────────────────────────────

function sha(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  const hex = Math.abs(h).toString(16).padStart(8, "0");
  return (hex + hex + hex + hex + hex).slice(0, 40);
}

type DemoGitData = { commits: CommitEntry[]; status: GitStatus };

function makeCommits(projectName: string, messages: string[]): CommitEntry[] {
  let parentIds: string[] = [];
  return messages.map((msg, i) => {
    const id = sha(`${projectName}-commit-${i}`);
    const entry: CommitEntry = {
      id,
      message: msg,
      author: ["dev_nika", "SakuraBuilder", "ProjectOwner"][i % 3],
      timestamp: daysAgo(messages.length - i - 1) + (i * 3600),
      parent_ids: parentIds,
    };
    parentIds = [id];
    return entry;
  }).reverse();
}

const AVATAR_COMMITS = [
  "init: create Unity project with VRC SDK + liltoon",
  "feat: import base avatar package",
  "feat: set up PhysBone chains for hair and skirt",
  "fix: correct bone weight painting on left elbow",
  "feat: add face tracking blendshapes",
  "style: apply recolor pass — skin tone variant A",
  "style: apply recolor pass — skin tone variant B",
  "feat: add custom hand pose animations",
  "fix: resolve z-fighting on chest material",
  "feat: setup FX layer for outfit toggle",
  "fix: blendshape for hand gesture L not applying",
  "feat: add dynamic bone secondary motion to tail",
  "fix: material slot ordering after prefab merge",
  "perf: reduce texture atlas from 4k to 2k on LOD1",
  "feat: add emissive scroll shader on eyes",
  "fix: correct avatar descriptor view position",
  "test: validate upload on VRChat test client",
  "chore: clean up unused prefab overrides",
  "release: v1.0 — ready for upload",
];

const WORLD_COMMITS = [
  "init: create world project with Worlds SDK",
  "feat: blockout main stage area",
  "feat: add directional lighting rig",
  "fix: navmesh bake fails on staircase",
  "feat: add audio zone for main stage",
  "style: apply PBR materials to floor and walls",
  "feat: add VRC_Station for front-row seats",
  "fix: portal collider offset",
  "feat: add post-processing volume (bloom + CA)",
  "perf: reduce draw calls — static batching pass",
  "feat: add mirror in backstage area",
  "fix: udon script null ref on player join",
  "release: beta — send to testers",
];

export const DEMO_GIT_DATA: Record<string, DemoGitData> = {
  "demo-proj-0001": {
    commits: makeCommits("Yukimi_Recolor_v2", AVATAR_COMMITS),
    status: { branch: "main", has_upstream: true, ahead: 2, behind: 0, staged: [], unstaged: ["Assets/Materials/Yukimi_SkinA.mat"], untracked: [] },
  },
  "demo-proj-0002": {
    commits: makeCommits("Kasumi_Spring2025", AVATAR_COMMITS.slice(0, 12)),
    status: { branch: "feature/outfit-toggle", has_upstream: true, ahead: 5, behind: 1, staged: ["Assets/Animations/FX_OutfitToggle.controller"], unstaged: [], untracked: ["Assets/Textures/NewHair_normal.png"] },
  },
  "demo-proj-0003": {
    commits: makeCommits("Nocturne_ClubBuild", AVATAR_COMMITS.slice(0, 8)),
    status: { branch: "main", has_upstream: false, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] },
  },
  "demo-proj-0004": {
    commits: makeCommits("Rindo_FestivalStage", AVATAR_COMMITS.slice(0, 14)),
    status: { branch: "main", has_upstream: true, ahead: 0, behind: 2, staged: [], unstaged: ["Assets/Textures/Rindo_FestivalDress.png"], untracked: [] },
  },
  "demo-proj-0005": {
    commits: makeCommits("FestivalStage_World", WORLD_COMMITS),
    status: { branch: "main", has_upstream: true, ahead: 0, behind: 3, staged: [], unstaged: ["Assets/Scenes/FestivalStage.unity"], untracked: ["Assets/Audio/crowd_applause.wav"] },
  },
  "demo-proj-0006": {
    commits: makeCommits("Himeko_WIP", AVATAR_COMMITS.slice(0, 5)),
    status: { branch: "wip/initial-setup", has_upstream: false, ahead: 0, behind: 0, staged: [], unstaged: [], untracked: ["Assets/Models/himeko_imported.fbx"] },
  },
};

export function getDemoGitData(projectIdOrPath: string): DemoGitData | null {
  if (DEMO_GIT_DATA[projectIdOrPath]) return DEMO_GIT_DATA[projectIdOrPath];
  const proj = DEMO_PROJECTS.find((p) => p.path === projectIdOrPath || p.id === projectIdOrPath);
  if (proj) return DEMO_GIT_DATA[proj.id] ?? null;
  return null;
}

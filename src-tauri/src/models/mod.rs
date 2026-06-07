use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UnityType {
    Standard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Shader {
    Liltoon,
    Poiyomi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub unity_version: String,
    pub unity_type: UnityType,
    pub avatar_base_id: Option<String>,
    pub shader: Option<Shader>,
    pub vcs_enabled: bool,
    /// Absolute path to the PNG screenshot taken after the last Unity session.
    pub last_screenshot: Option<String>,
    /// Absolute path to a user-defined cover image for this project.
    pub cover_image_path: Option<String>,
    /// ID of the folder this project belongs to (None = root).
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    pub emoji: Option<String>,
    pub image: Option<String>,
}

/// Registro completo de un paquete VPM custom, incluyendo sus asset IDs cargados en runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPackage {
    pub id: String,
    /// Identificador reverse-DNS: "com.user.mipaquete"
    pub name: String,
    pub display_name: String,
    /// Versión semántica: "1.0.0"
    pub version: String,
    pub description: Option<String>,
    /// Ruta absoluta al package.json generado (vacía si aún no se ha hecho build).
    pub json_path: String,
    /// Ruta absoluta al .zip generado (None si aún no se ha hecho build).
    pub zip_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// IDs de inventory_items incluidos en este paquete (cargados por JOIN en runtime).
    pub asset_ids: Vec<String>,
}

/// Payload del frontend para crear o actualizar un paquete custom.
#[derive(Debug, Deserialize)]
pub struct CreatePackagePayload {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: String,
    pub asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InventorySource {
    Booth,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub source: InventorySource,
    pub source_id: Option<String>,
    pub local_path: String,
    pub thumbnail_url: Option<String>,
    pub download_date: String,
    pub size_bytes: Option<i64>,
    pub tags: Vec<String>,
    pub is_compressed: bool,
    // ── v2 ──────────────────────────────────────────
    pub display_name: Option<String>,
    pub custom_cover_path: Option<String>,
    pub sort_order: Option<i32>,
    pub product_images: Vec<String>,
    pub custom_images: Vec<String>,
    /// ID de la carpeta a la que pertenece este item (None = raíz)
    pub folder_id: Option<String>,
    pub is_multi_avatar: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub custom_image_path: Option<String>,
    pub sort_order: Option<i32>,
    pub emoji: Option<String>,
    pub custom_image_fill: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemVariant {
    pub id: String,
    pub item_id: String,
    pub label: String,
    pub is_materials: bool,
    pub sub_zip_name: String,
    pub sort_order: i64,
    pub size_bytes: Option<u64>,
    pub is_compressed: bool,
    pub custom_image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantArg {
    pub label: String,
    pub is_materials: bool,
    pub sub_zip_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportMultiAvatarArgs {
    pub zip_path: String,
    pub name: String,
    pub author: Option<String>,
    pub thumbnail_url: Option<String>,
    pub booth_id: Option<String>,
    pub product_images: Vec<String>,
    pub variants: Vec<VariantArg>,
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpmRepository {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub url: String,
    pub last_fetched: Option<String>,
    pub is_official: bool,
}

// ── Projects Module ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnityInstallation {
    pub version: String,
    pub path: String,
    pub is_custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub destination_dir: String,
    pub unity_version: String,
    pub unity_path: String,
    pub unity_type: UnityType,
    pub avatar_base_id: Option<String>,
    pub shader: Option<Shader>,
    pub vcs_enabled: bool,
    /// Package IDs del índice VPM a instalar, ej: ["com.vrchat.avatars"]
    pub vpm_packages: Vec<String>,
    /// IDs de paquetes custom a instalar (sus ZIPs se copian a Packages/)
    #[serde(default)]
    pub custom_package_ids: Vec<String>,
    /// Items to auto-extract on first Unity open. Replaces early_import_item_ids.
    #[serde(default)]
    pub early_import_items: Vec<EarlyImportRef>,
}

/// Reference to an inventory item for early import, with optional variant selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarlyImportRef {
    pub item_id: String,
    /// If set, extract this specific sub-zip from the main archive instead of the whole archive.
    pub sub_zip_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectProgress {
    /// 0.0 – 1.0
    pub progress: f32,
    pub message: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarlyImportEntry {
    pub id: String,
    pub project_id: String,
    pub item_id: String,
    pub item_name: String,
    pub thumbnail_url: Option<String>,
    pub local_path: String,
    pub status: String, // "pending" | "done" | "error"
    pub imported_at: Option<String>,
    pub error_msg: Option<String>,
    pub sort_order: i64,
    pub sub_zip_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarlyImportProgressEvent {
    pub project_id: String,
    pub item_id: String,
    pub item_name: String,
    pub current: usize,
    pub total: usize,
    pub status: String, // "extracting" | "done" | "error" | "complete"
    pub error: Option<String>,
}

 #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct VpmPackageSample {
      pub display_name: String,
      pub description: String,
      pub path: String,
  }

  #[derive(Debug, Clone, Serialize, Deserialize)]
  pub struct VpmPackageVersion {
      pub name: String,
      pub display_name: String,
      pub version: String,
      pub unity: String,
      pub description: Option<String>,
      pub url: String,
      /// { "com.vrchat.base": ">=3.7.0" }
      pub dependencies: std::collections::HashMap<String, String>,
      // Extra VPM fields (optional — not all repos include them)
      #[serde(rename = "changelogUrl", default)]
      pub changelog_url: Option<String>,
      #[serde(rename = "documentationUrl", default)]
      pub documentation_url: Option<String>,
      #[serde(rename = "licensesUrl", default)]
      pub license_url: Option<String>,
      #[serde(default)]
      pub samples: Vec<VpmPackageSample>,
  }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpmPackage {
    pub id: String,
    /// Keyed by version string
    pub versions: std::collections::HashMap<String, VpmPackageVersion>,
}

impl VpmPackage {
    /// Returns the highest semver version, or None if empty.
    pub fn latest_version(&self) -> Option<&VpmPackageVersion> {
        self.versions
            .values()
            .max_by(|a, b| {
                let va = semver::Version::parse(&a.version).ok();
                let vb = semver::Version::parse(&b.version).ok();
                va.cmp(&vb)
            })
    }
}

// ── Tracker ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TrackerKind {
    Item,
    Author,
    Keyword,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerItem {
    pub id: String,
    pub kind: TrackerKind,
    // item fields
    pub booth_id: Option<String>,
    pub item_name: Option<String>,
    pub item_author: Option<String>,
    pub item_thumbnail_url: Option<String>,
    pub item_url: Option<String>,
    pub last_known_price: Option<String>,
    pub track_price_drops: bool,
    pub track_availability: bool,
    // author fields
    pub author_name: Option<String>,
    pub author_booth_shop_id: Option<String>,
    pub track_new_items: bool,
    // common
    pub check_interval_minutes: i64,
    pub last_checked_at: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub search_keyword: Option<String>,
    pub search_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerEvent {
    pub id: String,
    pub tracker_item_id: String,
    pub event_type: String,
    pub payload: String, // JSON string
    pub detected_at: String,
    pub is_read: bool,
}

/// Payload para crear un nuevo tracker item desde el frontend.
#[derive(Debug, Deserialize)]
pub struct CreateTrackerItemPayload {
    pub kind: TrackerKind,
    // item
    pub booth_id: Option<String>,
    pub item_name: Option<String>,
    pub item_author: Option<String>,
    pub item_thumbnail_url: Option<String>,
    pub item_url: Option<String>,
    pub track_price_drops: Option<bool>,
    pub track_availability: Option<bool>,
    // author
    pub author_name: Option<String>,
    pub author_booth_shop_id: Option<String>,
    pub track_new_items: Option<bool>,
    // common
    pub check_interval_minutes: Option<i64>,
    pub search_keyword: Option<String>,
    pub search_category: Option<String>,
}

/// Payload para actualizar configuración de un tracker item existente.
#[derive(Debug, Deserialize)]
pub struct UpdateTrackerItemPayload {
    pub track_price_drops: Option<bool>,
    pub track_availability: Option<bool>,
    pub track_new_items: Option<bool>,
    pub check_interval_minutes: Option<i64>,
    pub is_active: Option<bool>,
}

// ── Prefab / Unity scene ─────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrefabNode {
    pub file_id: u64,
    pub name: String,
    pub is_active: bool,
    pub children: Vec<PrefabNode>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnimStateInfo {
    pub name: String,
    pub clip_name: Option<String>,
    pub is_blend_tree: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnimLayerInfo {
    pub name: String,           // "Base", "Additive", "Gesture", "Action", "FX"
    pub states: Vec<AnimStateInfo>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AvatarInfo {
    pub view_position: Option<[f32; 3]>,  // ViewPosition {x,y,z}
    pub lip_sync_mode: Option<u8>,         // 0=VisemeBlendShape, etc.
    pub has_vrc_descriptor: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrefabScene {
    pub root_nodes: Vec<PrefabNode>,
    pub anim_layers: Vec<AnimLayerInfo>,  // vacío si no hay .controller parseable
    pub avatar_info: AvatarInfo,
    pub suggested_mesh_file: Option<String>, // ruta relativa al FBX/GLB encontrado al lado del prefab
}
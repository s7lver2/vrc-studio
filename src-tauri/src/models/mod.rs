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
    Riperstore,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpmRepository {
    pub id: String,
    pub name: String,
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
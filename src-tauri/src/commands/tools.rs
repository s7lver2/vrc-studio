// src-tauri/src/commands/tools.rs
use crate::db::DbPool;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use tauri::Manager;
use tauri::State;

// ── Types ──────────────────────────────────────────────────────────────────

/// An entry from the remote tools registry (tools-registry.json).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub icon_url: String,
    pub banner_url: String,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub category: String,
    pub downloads: ToolDownloads,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub requires_unity: bool,
    #[serde(default)]
    pub min_unity_version: String,
    #[serde(default)]
    pub featured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolDownloads {
    #[serde(default)]
    pub ui_bundle: String,
    #[serde(default)]
    pub sidecar_windows: String,
    #[serde(default)]
    pub sidecar_macos: String,
    #[serde(default)]
    pub sidecar_linux: String,
}

/// A tool that has been installed locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledTool {
    pub id: String,
    pub name: String,
    pub version: String,
    pub installed_at: String,
    pub enabled: bool,
    pub metadata: ToolRegistryEntry,
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Returns all enabled installed tools from the local DB.
#[tauri::command]
pub fn tools_list(pool: State<'_, DbPool>) -> Result<Vec<InstalledTool>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, version, installed_at, enabled, metadata
         FROM tools_installed WHERE enabled = 1 ORDER BY installed_at DESC",
    )?;
    let tools = stmt
        .query_map([], |row| {
            let metadata_json: String = row.get(5)?;
            Ok(InstalledTool {
                id:           row.get(0)?,
                name:         row.get(1)?,
                version:      row.get(2)?,
                installed_at: row.get(3)?,
                enabled:      row.get::<_, i64>(4)? != 0,
                metadata:     serde_json::from_str(&metadata_json)
                                  .unwrap_or_default(),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tools)
}

const REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/YOUR_ORG/vrc-studio-tools/main/registry.json";
const REGISTRY_TTL_SECS: u64 = 3600; // 1 hour

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsRegistry {
    pub version: u32,
    pub tools: Vec<ToolRegistryEntry>,
}

/// Fetches the remote tools registry (cached locally for 1 hour).
/// Returns the list of available tools.
#[tauri::command]
pub async fn tools_fetch_registry(
    app: tauri::AppHandle,
) -> Result<Vec<ToolRegistryEntry>, AppError> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let cache_path = cache_dir.join("tools_registry_cache.json");

    // Return cached version if fresh enough
    if let Ok(meta) = std::fs::metadata(&cache_path) {
        if let Ok(modified) = meta.modified() {
            let age = SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default()
                .as_secs();
            if age < REGISTRY_TTL_SECS {
                if let Ok(data) = std::fs::read_to_string(&cache_path) {
                    if let Ok(registry) = serde_json::from_str::<ToolsRegistry>(&data) {
                        return Ok(registry.tools);
                    }
                }
            }
        }
    }

    // Fetch fresh copy
    let response = reqwest::get(REGISTRY_URL)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let registry: ToolsRegistry = serde_json::from_str(&text)
        .map_err(|e| AppError::Parse(e.to_string()))?;

    // Cache to disk
    let _ = std::fs::write(&cache_path, &text);

    Ok(registry.tools)
}

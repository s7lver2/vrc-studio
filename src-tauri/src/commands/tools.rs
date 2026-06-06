// src-tauri/src/commands/tools.rs
use crate::db::DbPool;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
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

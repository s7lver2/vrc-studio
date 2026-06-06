// src-tauri/src/commands/tools.rs
use crate::db::DbPool;
use crate::error::AppError;
use futures_util::StreamExt;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::SystemTime;
use tauri::Emitter;
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

/// Downloads and installs a tool from the registry.
/// Emits `tools://install-progress` events: `{ id, progress: 0.0..1.0, step: String }`.
#[tauri::command]
pub async fn tools_install(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
    entry: ToolRegistryEntry,
) -> Result<InstalledTool, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let tool_dir = app_data.join("tools").join(&entry.id);
    std::fs::create_dir_all(&tool_dir)
        .map_err(|e| AppError::Io(e.to_string()))?;

    // Pick sidecar URL for current platform
    let sidecar_url = if cfg!(target_os = "windows") {
        &entry.downloads.sidecar_windows
    } else if cfg!(target_os = "macos") {
        &entry.downloads.sidecar_macos
    } else {
        &entry.downloads.sidecar_linux
    };

    if !sidecar_url.is_empty() {
        let sidecar_name = if cfg!(target_os = "windows") { "core.exe" } else { "core" };
        let sidecar_path = tool_dir.join(sidecar_name);

        emit_progress(&app, &entry.id, 0.05, "Descargando sidecar…");
        download_file(&app, &entry.id, sidecar_url, &sidecar_path, 0.05, 0.85).await?;

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&sidecar_path)
                .map_err(|e| AppError::Io(e.to_string()))?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&sidecar_path, perms)
                .map_err(|e| AppError::Io(e.to_string()))?;
        }
    }

    emit_progress(&app, &entry.id, 0.9, "Guardando en base de datos…");

    // Write to DB
    let conn = pool.get()?;
    let metadata_json = serde_json::to_string(&entry)
        .map_err(|e| AppError::Parse(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO tools_installed (id, name, version, installed_at, enabled, metadata)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![entry.id, entry.name, entry.version, now, metadata_json],
    )?;

    emit_progress(&app, &entry.id, 1.0, "Instalado");

    Ok(InstalledTool {
        id:           entry.id.clone(),
        name:         entry.name.clone(),
        version:      entry.version.clone(),
        installed_at: now,
        enabled:      true,
        metadata:     entry,
    })
}

fn emit_progress(app: &tauri::AppHandle, id: &str, progress: f64, step: &str) {
    let _ = app.emit("tools://install-progress", serde_json::json!({
        "id": id,
        "progress": progress,
        "step": step,
    }));
}

async fn download_file(
    app: &tauri::AppHandle,
    tool_id: &str,
    url: &str,
    dest: &std::path::PathBuf,
    progress_start: f64,
    progress_end: f64,
) -> Result<(), AppError> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let total = response.content_length().unwrap_or(1);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file_bytes = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Network(e.to_string()))?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);
        let ratio = downloaded as f64 / total as f64;
        let prog = progress_start + ratio * (progress_end - progress_start);
        emit_progress(app, tool_id, prog, "Descargando…");
    }

    std::fs::write(dest, file_bytes).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}

/// Removes a tool: deletes its AppData folder and removes the DB row.
#[tauri::command]
pub async fn tools_uninstall(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
    id: String,
) -> Result<(), AppError> {
    // Remove files
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let tool_dir = app_data.join("tools").join(&id);
    if tool_dir.exists() {
        std::fs::remove_dir_all(&tool_dir)
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    // Remove from DB
    let conn = pool.get()?;
    conn.execute("DELETE FROM tools_installed WHERE id = ?1", params![id])?;
    Ok(())
}

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

// ── Scene/Avatar scanning + sidecar runner ────────────────────────────────

use tokio::io::{AsyncBufReadExt, BufReader as AsyncBufReader};
use tokio::process::Command as TokioCommand;

#[derive(Debug, Serialize, Deserialize)]
pub struct SceneFile {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AvatarDescriptor {
    pub name: String,
    pub file_id: String,
}

/// Lists all .unity scene files under a project's Assets folder.
#[tauri::command]
pub fn tools_scan_scenes(project_path: String) -> Result<Vec<SceneFile>, AppError> {
    let assets = std::path::Path::new(&project_path).join("Assets");
    if !assets.exists() {
        return Err(AppError::Io(format!("Assets folder not found: {}", assets.display())));
    }
    let mut scenes = Vec::new();
    for entry in walkdir::WalkDir::new(&assets)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "unity").unwrap_or(false))
    {
        let rel = entry.path()
            .strip_prefix(&project_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let name = entry.path()
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        scenes.push(SceneFile { path: rel, name });
    }
    Ok(scenes)
}

/// Parses a .unity scene file and returns all GameObjects with a VRC_AvatarDescriptor component.
#[tauri::command]
pub fn tools_scan_avatars(
    project_path: String,
    scene_path: String,
) -> Result<Vec<AvatarDescriptor>, AppError> {
    let full_path = format!("{}/{}", project_path, scene_path);
    let text = std::fs::read_to_string(&full_path)
        .map_err(|e| AppError::Io(e.to_string()))?;

    let mut avatars = Vec::new();
    let doc_sep = regex::Regex::new(r"--- !u!(\d+) &(\d+)").unwrap();
    let documents: Vec<_> = doc_sep.find_iter(&text).collect();

    let name_re = regex::Regex::new(r"m_Name:\s*(.+)").unwrap();
    let file_id_re = regex::Regex::new(r"m_GameObject:\s*\{fileID:\s*(\d+)").unwrap();

    for (i, header_match) in documents.iter().enumerate() {
        let start = header_match.start();
        let end = if i + 1 < documents.len() { documents[i + 1].start() } else { text.len() };
        let doc_text = &text[start..end];

        let class_id: u32 = doc_sep.captures(doc_text)
            .and_then(|c| c.get(1))
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(0);

        if class_id != 114 { continue; }

        let is_avatar_descriptor = doc_text.contains("viewPosition:")
            && (doc_text.contains("lipSync:") || doc_text.contains("customEyeLookSettings:"));

        if !is_avatar_descriptor { continue; }

        let go_file_id = file_id_re.captures(doc_text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        let go_name = find_go_name(&text, &go_file_id, &name_re);

        avatars.push(AvatarDescriptor { name: go_name, file_id: go_file_id });
    }

    Ok(avatars)
}

fn find_go_name(scene_text: &str, file_id: &str, name_re: &regex::Regex) -> String {
    let pattern = format!("&{}", file_id);
    if let Some(pos) = scene_text.find(&pattern) {
        let section = &scene_text[pos..std::cmp::min(scene_text.len(), pos + 500)];
        if let Some(cap) = name_re.captures(section) {
            return cap[1].trim().to_string();
        }
    }
    format!("Avatar (fileID {})", file_id)
}

/// Spawns the tool's sidecar binary, sends request JSON via stdin,
/// streams progress events, returns the final JSON result.
#[tauri::command]
pub async fn tools_run_sidecar(
    app: tauri::AppHandle,
    tool_id: String,
    request: serde_json::Value,
) -> Result<serde_json::Value, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;

    let sidecar_name = if cfg!(target_os = "windows") { "core.exe" } else { "core" };
    let sidecar_path = app_data.join("tools").join(&tool_id).join(sidecar_name);

    if !sidecar_path.exists() {
        return Err(AppError::Io(format!("Sidecar not found: {}", sidecar_path.display())));
    }

    let request_json = serde_json::to_string(&request)
        .map_err(|e| AppError::Parse(e.to_string()))?;

    let mut child = TokioCommand::new(&sidecar_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Io(e.to_string()))?;

    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(request_json.as_bytes()).await
            .map_err(|e| AppError::Io(e.to_string()))?;
        stdin.write_all(b"\n").await.ok();
    }

    let stdout = child.stdout.take().ok_or_else(|| AppError::Io("no stdout".into()))?;
    let mut lines = AsyncBufReader::new(stdout).lines();
    let mut last_line = String::new();

    while let Some(line) = lines.next_line().await.map_err(|e| AppError::Io(e.to_string()))? {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if val.get("progress").is_some() {
                let _ = app.emit("tools://sidecar-progress", &val);
            } else {
                last_line = line;
            }
        }
    }

    child.wait().await.ok();

    if last_line.is_empty() {
        return Err(AppError::Parse("Sidecar returned no output".into()));
    }

    serde_json::from_str(&last_line)
        .map_err(|e| AppError::Parse(format!("Invalid sidecar JSON: {e}")))
}

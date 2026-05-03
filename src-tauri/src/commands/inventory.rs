use crate::error::AppError;
use crate::models::{InventoryFolder, InventoryItem, InventorySource};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{Manager, State};
use uuid::Uuid;

// ── DB row → model conversion ─────────────────────────────────────────────────

fn row_to_item(row: &sqlx::sqlite::SqliteRow) -> InventoryItem {
    let source_str: String = row.get("source");
    let source = match source_str.as_str() {
        "booth" => InventorySource::Booth,
        "riperstore" => InventorySource::Riperstore,
        _ => InventorySource::Local,
    };

    let tags_str: Option<String> = row.try_get("tags").ok();
    let tags: Vec<String> = tags_str
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let is_compressed: i64 = row.try_get("is_compressed").unwrap_or(0);

    InventoryItem {
        id: row.get("id"),
        name: row.get("name"),
        author: row.get("author"),
        source,
        source_id: row.get("source_id"),
        local_path: row.get("local_path"),
        thumbnail_url: row.try_get("thumbnail_url").ok().flatten(),
        download_date: row.get("download_date"),
        size_bytes: row.get("size_bytes"),
        tags,
        is_compressed: is_compressed != 0,
    }
}

fn row_to_folder(row: &sqlx::sqlite::SqliteRow) -> InventoryFolder {
    InventoryFolder {
        id: row.get("id"),
        name: row.get("name"),
        parent_id: row.get("parent_id"),
    }
}

// ── Delete mode ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum DeleteMode {
    InventoryOnly,
    InventoryAndDisk,
    InventoryDiskAndProjects,
}

// ── Internal query helpers (también usados en tests) ──────────────────────────

pub async fn list_inventory_items_query(
    pool: &SqlitePool,
) -> Result<Vec<InventoryItem>, AppError> {
    let rows = sqlx::query(
        "SELECT id, name, author, source, source_id, local_path, thumbnail_url,
                download_date, size_bytes, tags, is_compressed
         FROM inventory_items
         ORDER BY download_date DESC",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(row_to_item).collect())
}

pub async fn delete_inventory_item_query(
    pool: &SqlitePool,
    item_id: &str,
    mode: DeleteMode,
) -> Result<(), AppError> {
    // Obtener local_path antes de borrar
    let row = sqlx::query("SELECT local_path FROM inventory_items WHERE id = ?")
        .bind(item_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("InventoryItem {}", item_id)))?;

    let local_path: String = row.get("local_path");

    // Borrar de DB (CASCADE elimina folder_items)
    sqlx::query("DELETE FROM inventory_items WHERE id = ?")
        .bind(item_id)
        .execute(pool)
        .await?;

    match mode {
        DeleteMode::InventoryOnly => {}

        DeleteMode::InventoryAndDisk => {
            remove_from_disk(&local_path)?;
        }

        DeleteMode::InventoryDiskAndProjects => {
            remove_from_disk(&local_path)?;
            sqlx::query("DELETE FROM project_assets WHERE inventory_item_id = ?")
                .bind(item_id)
                .execute(pool)
                .await?;
        }
    }

    Ok(())
}

fn remove_from_disk(path: &str) -> Result<(), AppError> {
    let p = std::path::Path::new(path);
    if p.exists() {
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(|e| AppError::External(e.to_string()))?;
        } else {
            std::fs::remove_file(p).map_err(|e| AppError::External(e.to_string()))?;
        }
    }
    Ok(())
}

pub async fn create_folder_query(
    pool: &SqlitePool,
    name: &str,
    parent_id: Option<&str>,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO inventory_folders (id, name, parent_id) VALUES (?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(parent_id)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn list_folders_query(pool: &SqlitePool) -> Result<Vec<InventoryFolder>, AppError> {
    let rows = sqlx::query("SELECT id, name, parent_id FROM inventory_folders ORDER BY name")
        .fetch_all(pool)
        .await?;
    Ok(rows.iter().map(row_to_folder).collect())
}

// ── Tauri Commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_inventory(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<InventoryItem>, AppError> {
    list_inventory_items_query(&pool).await
}

#[tauri::command]
pub async fn delete_inventory_item(
    pool: State<'_, SqlitePool>,
    item_id: String,
    mode: DeleteMode,
) -> Result<(), AppError> {
    delete_inventory_item_query(&pool, &item_id, mode).await
}

#[tauri::command]
pub async fn create_inventory_folder(
    pool: State<'_, SqlitePool>,
    name: String,
    parent_id: Option<String>,
) -> Result<String, AppError> {
    create_folder_query(&pool, &name, parent_id.as_deref()).await
}

#[tauri::command]
pub async fn list_inventory_folders(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<InventoryFolder>, AppError> {
    list_folders_query(&pool).await
}

#[tauri::command]
pub async fn move_item_to_folder(
    pool: State<'_, SqlitePool>,
    item_id: String,
    folder_id: String,
) -> Result<(), AppError> {
    // Quitar de cualquier carpeta previa
    sqlx::query("DELETE FROM inventory_folder_items WHERE item_id = ?")
        .bind(&item_id)
        .execute(&*pool)
        .await?;

    sqlx::query(
        "INSERT INTO inventory_folder_items (folder_id, item_id) VALUES (?, ?)",
    )
    .bind(&folder_id)
    .bind(&item_id)
    .execute(&*pool)
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn tag_inventory_item(
    pool: State<'_, SqlitePool>,
    item_id: String,
    tags: Vec<String>,
) -> Result<(), AppError> {
    let tags_json = serde_json::to_string(&tags).map_err(|e| AppError::External(e.to_string()))?;
    sqlx::query("UPDATE inventory_items SET tags = ? WHERE id = ?")
        .bind(&tags_json)
        .bind(&item_id)
        .execute(&*pool)
        .await?;
    Ok(())
}

// ── File tree ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub extension: Option<String>,
    pub children: Option<Vec<FileNode>>,
}

/// Directories that Unity auto-generates and are useless/slow to traverse.
/// Skipped in the Rust tree builder so they never make it into the JSON payload.
const UNITY_SKIP_DIRS: &[&str] = &[
    "Library", "Temp", "Logs", "obj", "Builds", "Build",
    "UserSettings", ".vs", ".idea", ".git", "__pycache__",
];

/// File extensions that are Unity-generated noise (always skipped).
const UNITY_SKIP_EXTS: &[&str] = &[
    "meta", "csproj", "sln", "user", "suo", "tmp", "pidb",
    "userprefs", "unityproj",
];

/// Junk filenames to skip regardless of location.
const UNITY_SKIP_FILES: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini"];

fn should_skip(entry_name: &str, is_dir: bool, ext: Option<&str>) -> bool {
    if is_dir { return UNITY_SKIP_DIRS.contains(&entry_name); }
    if UNITY_SKIP_FILES.contains(&entry_name) { return true; }
    if let Some(e) = ext { return UNITY_SKIP_EXTS.contains(&e); }
    false
}

fn build_file_tree(path: &std::path::Path, depth: u32) -> FileNode {
    let name = path
        .file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .to_string();
    let full_path = path.to_string_lossy().to_string();

    // Cap at depth 6 — deep nesting past this is rarely useful and caused multi-second freezes.
    if path.is_dir() && depth < 6 {
        let mut children: Vec<FileNode> = std::fs::read_dir(path)
            .map(|entries| {
                let mut nodes: Vec<FileNode> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let p = e.path();
                        let entry_name = p.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let is_dir = p.is_dir();
                        let ext = p.extension().map(|ex| ex.to_string_lossy().to_lowercase());
                        if should_skip(&entry_name, is_dir, ext.as_deref()) {
                            return None;
                        }
                        Some(build_file_tree(&p, depth + 1))
                    })
                    .collect();
                nodes.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
                nodes
            })
            .unwrap_or_default();

        FileNode {
            name,
            path: full_path,
            is_dir: true,
            size: None,
            extension: None,
            children: Some(children),
        }
    } else {
        let size = std::fs::metadata(path).map(|m| m.len()).ok();
        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());
        FileNode {
            name,
            path: full_path,
            is_dir: path.is_dir(),
            size,
            extension,
            children: if path.is_dir() { Some(vec![]) } else { None },
        }
    }
}

#[tauri::command]
pub async fn get_file_tree(path: String) -> Result<FileNode, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path not found: {}", path));
    }
    // spawn_blocking so the filesystem walk never blocks the Tauri async runtime.
    tokio::task::spawn_blocking(move || build_file_tree(&p, 0))
        .await
        .map_err(|e| format!("Tree build task failed: {e}"))
}

/// Opens the system file explorer at the given path.
/// If the path is a file, opens its parent directory.
#[tauri::command]
pub fn open_item_location(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let target = if p.is_file() {
        p.parent().unwrap_or(p).to_owned()
    } else {
        p.to_owned()
    };
    let target_str = target.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&target_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── UnityPackage reader ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnityAsset {
    pub guid: String,
    pub asset_path: String,
    pub has_asset_file: bool,
    pub size: Option<u64>,
}

#[tauri::command]
pub fn read_unitypackage(path: String) -> Result<Vec<UnityAsset>, String> {
    use std::io::Read;
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open file: {}", e))?;
    let gz = GzDecoder::new(file);
    let mut archive = Archive::new(gz);

    let mut pathnames: std::collections::HashMap<String, String> = Default::default();
    let mut asset_sizes: std::collections::HashMap<String, u64> = Default::default();

    let entries = archive.entries().map_err(|e| format!("Cannot read archive: {}", e))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let entry_path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let parts: Vec<_> = entry_path.components().collect();
        if parts.len() < 2 { continue; }

        let guid = parts[0].as_os_str().to_string_lossy().to_string();
        let file_name = parts[parts.len() - 1].as_os_str().to_string_lossy().to_string();

        match file_name.as_str() {
            "pathname" => {
                let mut content = String::new();
                entry.read_to_string(&mut content).unwrap_or(0);
                let trimmed = content.trim().replace('\r', "");
                pathnames.insert(guid, trimmed);
            }
            "asset" => {
                let size = entry.header().size().unwrap_or(0);
                asset_sizes.insert(guid, size);
            }
            _ => {}
        }
    }

    let mut assets: Vec<UnityAsset> = pathnames
        .into_iter()
        .map(|(guid, asset_path)| {
            let size = asset_sizes.get(&guid).copied();
            UnityAsset {
                has_asset_file: size.is_some(),
                size,
                guid,
                asset_path,
            }
        })
        .collect();

    assets.sort_by(|a, b| a.asset_path.cmp(&b.asset_path));
    Ok(assets)
}

// ── Product images cache ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_item_product_images(
    pool: State<'_, SqlitePool>,
    item_id: String,
    images: Vec<String>,
) -> Result<(), AppError> {
    let json = serde_json::to_string(&images).map_err(|e| AppError::External(e.to_string()))?;
    sqlx::query("UPDATE inventory_items SET product_images = ? WHERE id = ?")
        .bind(&json)
        .bind(&item_id)
        .execute(&*pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_item_product_images(
    pool: State<'_, SqlitePool>,
    item_id: String,
) -> Result<Vec<String>, AppError> {
    let row = sqlx::query("SELECT product_images FROM inventory_items WHERE id = ?")
        .bind(&item_id)
        .fetch_optional(&*pool)
        .await?;

    match row {
        None => Ok(vec![]),
        Some(r) => {
            let raw: Option<String> = r.try_get("product_images").ok().flatten();
            Ok(raw
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_default())
        }
    }
}

// ── Import local package ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_local_package(
    app: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    zip_path: String,
    name: String,
    author: Option<String>,
    thumbnail_url: Option<String>,
    booth_id: Option<String>,
) -> Result<String, AppError> {
    use std::path::Path;

    let src = Path::new(&zip_path);
    if !src.exists() {
        return Err(AppError::External(format!("File not found: {}", zip_path)));
    }

    let item_id = uuid::Uuid::new_v4().to_string();
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::External(e.to_string()))?
        .join("downloads")
        .join("local")
        .join(&item_id);

    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| AppError::External(e.to_string()))?;

    let ext = src.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("zip");
    let dest = cache_dir.join(format!("{}.{}", &item_id[..8], ext));
    std::fs::copy(src, &dest)
        .map_err(|e| AppError::External(format!("Copy failed: {}", e)))?;

    let final_path = if ext.eq_ignore_ascii_case("zip") {
        let mut archive = zip::ZipArchive::new(
            std::fs::File::open(&dest).map_err(|e| AppError::External(e.to_string()))?,
        ).map_err(|e| AppError::External(e.to_string()))?;

        let extract_dir = cache_dir.join("extracted");
        std::fs::create_dir_all(&extract_dir)
            .map_err(|e| AppError::External(e.to_string()))?;
        archive.extract(&extract_dir)
            .map_err(|e| AppError::External(e.to_string()))?;

        // If the zip has a single top-level directory, unwrap it so local_path
        // points directly to that directory (avoids extracted/extracted nesting later)
        let entries: Vec<_> = std::fs::read_dir(&extract_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        let final_extract = if entries.len() == 1 {
            let entry_path = entries[0].path();
            if entry_path.is_dir() { entry_path } else { extract_dir.clone() }
        } else {
            extract_dir.clone()
        };
        final_extract
    } else {
        dest
    };

    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes: i64 = std::fs::metadata(src)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    sqlx::query(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?, ?, ?, 'local', ?, ?, ?, ?, ?, '[]')",
    )
    .bind(&item_id)
    .bind(&name)
    .bind(&author)
    .bind(&booth_id)
    .bind(&local_path)
    .bind(&thumbnail_url)
    .bind(&now)
    .bind(size_bytes)
    .execute(&*pool)
    .await?;

    Ok(item_id)
}

// ── Compression ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn compress_item(
    app: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    item_id: String,
) -> Result<(), AppError> {
    use std::path::Path;
    use tauri::Emitter;

    let row = sqlx::query("SELECT local_path, is_compressed FROM inventory_items WHERE id = ?")
        .bind(&item_id)
        .fetch_optional(&*pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("InventoryItem {}", item_id)))?;

    let local_path: String = row.get("local_path");
    let is_compressed: i64 = row.try_get("is_compressed").unwrap_or(0);

    if is_compressed != 0 {
        return Ok(());
    }

    let src = Path::new(&local_path);
    if !src.exists() {
        return Err(AppError::External(format!("Path not found: {}", local_path)));
    }

    let zip_path = format!("{}.vrczip", local_path);
    let zip_path_clone = zip_path.clone();
    let local_path_clone = local_path.clone();
    let item_id_clone = item_id.clone();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        use zip::CompressionMethod;

        let zip_file = std::fs::File::create(&zip_path_clone)
            .map_err(|e| e.to_string())?;
        let mut writer = zip::ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(9));

        let src_path = std::path::Path::new(&local_path_clone);

        let mut all_files: Vec<std::path::PathBuf> = Vec::new();
        if src_path.is_dir() {
            for entry in walkdir::WalkDir::new(src_path).into_iter().filter_map(|e| e.ok()) {
                if entry.file_type().is_file() {
                    all_files.push(entry.path().to_owned());
                }
            }
        } else {
            all_files.push(src_path.to_owned());
        }

        let total = all_files.len().max(1);
        for (i, file_path) in all_files.iter().enumerate() {
            let rel = {
                let stripped = file_path.strip_prefix(src_path)
                    .unwrap_or(file_path)
                    .to_string_lossy()
                    .replace('\\', "/");
                // For a single-file source, strip_prefix returns an empty string — use filename instead
                if stripped.is_empty() {
                    file_path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                } else {
                    stripped
                }
            };

            writer.start_file(&rel, options).map_err(|e| e.to_string())?;
            let bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;
            writer.write_all(&bytes).map_err(|e| e.to_string())?;

            let pct = ((i + 1) as f64 / total as f64) * 100.0;
            let _ = app_clone.emit(
                "compress://progress",
                serde_json::json!({
                    "item_id": item_id_clone,
                    "percentage": pct,
                    "phase": "compressing"
                }),
            );
        }

        writer.finish().map_err(|e| e.to_string())?;

        if src_path.is_dir() {
            std::fs::remove_dir_all(src_path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(src_path).map_err(|e| e.to_string())?;
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(AppError::External)?;

    sqlx::query("UPDATE inventory_items SET local_path = ?, is_compressed = 1 WHERE id = ?")
        .bind(&zip_path)
        .bind(&item_id)
        .execute(&*pool)
        .await?;

    let _ = app.emit(
        "compress://progress",
        serde_json::json!({ "item_id": item_id, "percentage": 100.0, "phase": "done" }),
    );

    Ok(())
}

#[tauri::command]
pub async fn decompress_item(
    app: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    item_id: String,
) -> Result<(), AppError> {
    use tauri::Emitter;

    let row = sqlx::query("SELECT local_path, is_compressed FROM inventory_items WHERE id = ?")
        .bind(&item_id)
        .fetch_optional(&*pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("InventoryItem {}", item_id)))?;

    let zip_path: String = row.get("local_path");
    let is_compressed: i64 = row.try_get("is_compressed").unwrap_or(0);

    if is_compressed == 0 {
        return Ok(());
    }

    let original_path = zip_path.trim_end_matches(".vrczip").to_string();
    let zip_path_clone = zip_path.clone();
    let original_path_clone = original_path.clone();
    let item_id_clone = item_id.clone();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&zip_path_clone).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let total = archive.len().max(1);

        std::fs::create_dir_all(&original_path_clone).map_err(|e| e.to_string())?;

        for i in 0..archive.len() {
            let mut zip_file = archive.by_index(i).map_err(|e| e.to_string())?;
            let out_path = std::path::Path::new(&original_path_clone)
                .join(zip_file.mangled_name());

            if zip_file.is_dir() {
                std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut outfile = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut zip_file, &mut outfile).map_err(|e| e.to_string())?;
            }

            let pct = ((i + 1) as f64 / total as f64) * 100.0;
            let _ = app_clone.emit(
                "compress://progress",
                serde_json::json!({
                    "item_id": item_id_clone,
                    "percentage": pct,
                    "phase": "decompressing"
                }),
            );
        }

        std::fs::remove_file(&zip_path_clone).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(AppError::External)?;

    sqlx::query("UPDATE inventory_items SET local_path = ?, is_compressed = 0 WHERE id = ?")
        .bind(&original_path)
        .bind(&item_id)
        .execute(&*pool)
        .await?;

    let _ = app.emit(
        "compress://progress",
        serde_json::json!({ "item_id": item_id, "percentage": 100.0, "phase": "done" }),
    );

    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    #[tokio::test]
    async fn test_crud_inventory_item() {
        let pool = create_test_pool().await.unwrap();

        let item_id = "test-item-1".to_string();
        sqlx::query(
            "INSERT INTO inventory_items
             (id, name, author, source, local_path, download_date, size_bytes, tags)
             VALUES (?, 'Test Avatar', 'Author', 'booth', '/tmp/test', '2026-01-01', 0, '[]')",
        )
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

        let items = list_inventory_items_query(&pool).await.unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "Test Avatar");
        assert_eq!(items[0].tags, Vec::<String>::new());

        delete_inventory_item_query(&pool, "test-item-1", DeleteMode::InventoryOnly)
            .await
            .unwrap();

        let items_after = list_inventory_items_query(&pool).await.unwrap();
        assert_eq!(items_after.len(), 0);
    }

    #[tokio::test]
    async fn test_create_and_list_folder() {
        let pool = create_test_pool().await.unwrap();

        let folder_id = create_folder_query(&pool, "My Folder", None).await.unwrap();
        let folders = list_folders_query(&pool).await.unwrap();

        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "My Folder");
        assert_eq!(folders[0].id, folder_id);
        assert_eq!(folders[0].parent_id, None);
    }

    #[tokio::test]
    async fn test_tag_item() {
        let pool = create_test_pool().await.unwrap();

        let item_id = "tag-test-item".to_string();
        sqlx::query(
            "INSERT INTO inventory_items
             (id, name, author, source, local_path, download_date, size_bytes, tags)
             VALUES (?, 'Tagged Item', 'Auth', 'local', '/tmp', '2026-01-01', 0, '[]')",
        )
        .bind(&item_id)
        .execute(&pool)
        .await
        .unwrap();

        let tags_json = serde_json::to_string(&vec!["base_model", "vrc"]).unwrap();
        sqlx::query("UPDATE inventory_items SET tags = ? WHERE id = ?")
            .bind(&tags_json)
            .bind(&item_id)
            .execute(&pool)
            .await
            .unwrap();

        let items = list_inventory_items_query(&pool).await.unwrap();
        assert_eq!(items[0].tags, vec!["base_model", "vrc"]);
    }
}
use crate::error::AppError;
use crate::models::{InventoryFolder, InventoryItem, InventorySource};
use serde::{Deserialize, Serialize};
use sqlx::{Row, SqlitePool};
use tauri::{Manager, State};
use std::path::Path;
use uuid::Uuid;

// ── DB row → model conversion ─────────────────────────────────────────────────

fn row_to_item(row: &sqlx::sqlite::SqliteRow) -> InventoryItem {
    let source_str: String = row.get("source");
    let source = match source_str.as_str() {
        "booth" => InventorySource::Booth,
        "riperstore" => InventorySource::Riperstore,
        _ => InventorySource::Local,
    };

    let tags_str: String = row.try_get("tags").unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();

    let is_compressed: i64 = row.try_get("is_compressed").unwrap_or(0);

    let product_images_str: String = row.try_get("product_images")
        .unwrap_or_else(|_| "[]".to_string());
    let product_images: Vec<String> = serde_json::from_str(&product_images_str)
        .unwrap_or_default();

    let custom_images_str: String = row.try_get("custom_images")
        .unwrap_or_else(|_| "[]".to_string());
    let custom_images: Vec<String> = serde_json::from_str(&custom_images_str)
        .unwrap_or_default();

    InventoryItem {
        id:                row.get("id"),
        name:              row.get("name"),
        author:            row.try_get("author").ok(),
        source,
        source_id:         row.try_get("source_id").ok(),
        local_path:        row.get("local_path"),
        thumbnail_url:     row.try_get("thumbnail_url").ok(),
        download_date:     row.get("download_date"),
        size_bytes:        row.try_get("size_bytes").ok(),
        tags,
        is_compressed:     row.try_get::<i64, _>("is_compressed").map(|v| v != 0).unwrap_or(false),
        display_name:      row.try_get("display_name").ok(),
        custom_cover_path: row.try_get("custom_cover_path").ok(),
        sort_order:        row.try_get("sort_order").ok(),
        product_images,
        custom_images,
        folder_id:         row.try_get("folder_id").ok(),
    }
}

fn row_to_folder(row: &sqlx::sqlite::SqliteRow) -> InventoryFolder {
    InventoryFolder {
        id:                row.get("id"),
        name:              row.get("name"),
        parent_id:         row.get("parent_id"),
        color:             row.try_get("color").ok(),
        custom_image_path: row.try_get("custom_image_path").ok(),
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
        "SELECT i.id, i.name, i.author, i.source, i.source_id, i.local_path, i.thumbnail_url,
        i.download_date, i.size_bytes, i.tags, i.is_compressed,
        i.display_name, i.custom_cover_path, i.sort_order,
        COALESCE(i.product_images, '[]') as product_images,
        COALESCE(i.custom_images, '[]') as custom_images,
        fi.folder_id as folder_id
 FROM inventory_items i
 LEFT JOIN inventory_folder_items fi ON fi.item_id = i.id
 ORDER BY COALESCE(i.sort_order, 999999999), i.download_date DESC",
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
    folder_id: Option<String>,
) -> Result<(), AppError> {
    if let Some(fid) = &folder_id {
        // Quitar de cualquier carpeta previa
        sqlx::query("DELETE FROM inventory_folder_items WHERE item_id = ?")
            .bind(&item_id)
            .execute(&*pool)
            .await?;

        // Insertar en la nueva carpeta
        sqlx::query(
            "INSERT INTO inventory_folder_items (folder_id, item_id) VALUES (?, ?)",
        )
        .bind(fid)
        .bind(&item_id)
        .execute(&*pool)
        .await?;
    } else {
        // Eliminar de cualquier carpeta (si estaba en alguna)
        sqlx::query("DELETE FROM inventory_folder_items WHERE item_id = ?")
            .bind(&item_id)
            .execute(&*pool)
            .await?;
    }

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
        let children: Vec<FileNode> = std::fs::read_dir(path)
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


/// Walks `dir` (non-recursively into subdirs up to depth 3) searching for
/// `.unitypackage` files. Each found package is extracted in-place into its
/// parent directory using `extract_unitypackage_to_dir`, and the original
/// `.unitypackage` file is kept.
///
/// Called after a ZIP is extracted so that bundled unity packages are
/// automatically unpacked and browseable in the sandbox file picker.
pub fn extract_unity_packages_in_dir(dir: &std::path::Path) {
    fn walk(dir: &std::path::Path, depth: u32) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < 3 { walk(&path, depth + 1); }
            } else {
                let is_pkg = path.extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("unitypackage"))
                    .unwrap_or(false);
                if !is_pkg { continue; }
                let parent = match path.parent() {
                    Some(p) => p.to_path_buf(),
                    None => continue,
                };
                // Extract into the same folder the .unitypackage lives in.
                if let Err(e) = crate::services::downloader::extract_unitypackage_to_dir(&path, &parent) {
                    eprintln!("[import] failed to extract {:?}: {}", path, e);
                }
                // Original .unitypackage is intentionally kept.
            }
        }
    }
    walk(dir, 0);
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
    // Use the user-configured assets root (respects Settings > Storage custom folder).
    // Falls back to the default app_cache_dir/downloads if not set.
    let cache_dir = crate::commands::app_settings::get_assets_root(&app)
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

        // After extracting the ZIP, scan for any .unitypackage files inside and
        // extract them in-place into their parent directory. The .unitypackage is
        // kept alongside the extracted contents.
        extract_unity_packages_in_dir(&final_extract);

        final_extract
    } else if ext.eq_ignore_ascii_case("unitypackage") {
        let extract_dir = cache_dir.join("extracted");
        std::fs::create_dir_all(&extract_dir)
            .map_err(|e| AppError::External(e.to_string()))?;
        crate::services::downloader::extract_unitypackage_to_dir(&dest, &extract_dir)
            .map_err(|e| AppError::External(e.to_string()))?;

        // Igual que zip: si hay un único directorio raíz, apuntar directamente a él
        let entries: Vec<_> = std::fs::read_dir(&extract_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        if entries.len() == 1 {
            let entry_path = entries[0].path();
            if entry_path.is_dir() { entry_path } else { extract_dir }
        } else {
            extract_dir
        }
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

// ── Reimport all assets ───────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct ReimportResult {
    pub item_id: String,
    pub name:    String,
    pub status:  String, // "ok" | "skipped" | "error"
    pub message: String,
}

/// Busca un .zip o .unitypackage en el directorio dado.
fn find_archive_in_dir(dir: &Path) -> Option<std::path::PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_file() {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext == "zip" || ext == "unitypackage" {
                return Some(p);
            }
        }
    }
    None
}

/// Extrae `archive` en `extract_dir` y aplica single-dir unwrap.
/// Devuelve el `final_path` que debería guardarse como local_path.
fn extract_archive_to(archive: &Path, extract_dir: &Path) -> Result<std::path::PathBuf, String> {
    let ext = archive.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    if ext == "zip" {
        std::fs::File::open(archive)
            .map_err(|e| e.to_string())
            .and_then(|f| zip::ZipArchive::new(f).map_err(|e| e.to_string()))
            .and_then(|mut a| a.extract(extract_dir).map_err(|e| e.to_string()))?;
    } else if ext == "unitypackage" {
        crate::services::downloader::extract_unitypackage_to_dir(archive, extract_dir)
            .map_err(|e| e.to_string())?;
    } else {
        return Err(format!("unsupported archive format: {ext}"));
    }

    // Single-dir unwrap: si solo hay un directorio raíz, apuntar a él
    let entries: Vec<_> = std::fs::read_dir(extract_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).collect())
        .unwrap_or_default();
    if entries.len() == 1 {
        let entry_path = entries[0].path();
        if entry_path.is_dir() { return Ok(entry_path); }
    }
    Ok(extract_dir.to_path_buf())
}

#[tauri::command]
pub async fn reimport_all_assets(
    pool: tauri::State<'_, SqlitePool>,
) -> Result<Vec<ReimportResult>, String> {
    let rows = sqlx::query("SELECT id, name, local_path FROM inventory_items")
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();

    for row in rows {
        let id:    String = row.get("id");
        let name:  String = row.get("name");
        let lpath: String = row.get("local_path");

        let lp = Path::new(&lpath);

        // ── Caso A: local_path es un archivo de archivo (.zip / .unitypackage) ──
        // Esto ocurre cuando el item fue importado antes de que la extracción
        // de unitypackage estuviera soportada.
        if lp.is_file() {
            let ext = lp.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext != "zip" && ext != "unitypackage" {
                results.push(ReimportResult {
                    item_id: id, name, status: "skipped".into(),
                    message: "local_path is a non-archive file".into(),
                });
                continue;
            }

            let extract_dir = match lp.parent() {
                Some(p) => p.join("extracted"),
                None    => { results.push(ReimportResult { item_id: id, name, status: "error".into(), message: "cannot determine parent dir".into() }); continue; }
            };

            // Si ya existe extracted/ de un intento previo, borrarlo
            if extract_dir.exists() {
                if let Err(e) = std::fs::remove_dir_all(&extract_dir) {
                    results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("failed to clear old extracted dir: {e}") });
                    continue;
                }
            }
            if let Err(e) = std::fs::create_dir_all(&extract_dir) {
                results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("failed to create extracted dir: {e}") });
                continue;
            }

            let archive = lp.to_path_buf();
            let extract_dir_clone = extract_dir.clone();
            let extract_result = tokio::task::spawn_blocking(move || {
                extract_archive_to(&archive, &extract_dir_clone)
            }).await;

            match extract_result {
                Ok(Ok(new_path)) => {
                    // Also extract any .unitypackage files found inside the ZIP.
                    extract_unity_packages_in_dir(&new_path);
                    let new_local_path = new_path.to_string_lossy().to_string();
                    let update = sqlx::query("UPDATE inventory_items SET local_path = ? WHERE id = ?")
                        .bind(&new_local_path)
                        .bind(&id)
                        .execute(&*pool)
                        .await;
                    match update {
                        Ok(_)  => results.push(ReimportResult { item_id: id, name, status: "ok".into(), message: format!("extracted and local_path updated → {new_local_path}") }),
                        Err(e) => results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("extracted but DB update failed: {e}") }),
                    }
                }
                Ok(Err(e)) => results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("extraction failed: {e}") }),
                Err(e)     => results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("task panic: {e}") }),
            }
            continue;
        }

        // ── Caso B: local_path es un directorio (ya fue extraído antes) ──
        if !lp.exists() {
            results.push(ReimportResult { item_id: id, name, status: "skipped".into(), message: "path does not exist".into() });
            continue;
        }
        if !lp.is_dir() {
            results.push(ReimportResult { item_id: id, name, status: "skipped".into(), message: "unknown local_path type".into() });
            continue;
        }

        // Determinar extracted_root y dónde buscar el archivo fuente
        let dir_name = lp.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let (extracted_root, cache_dir_opt) = if dir_name == "extracted" {
            (lp.to_path_buf(), lp.parent().map(|p| p.to_path_buf()))
        } else {
            let parent = lp.parent().unwrap_or(lp);
            let parent_name = parent.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if parent_name == "extracted" {
                (parent.to_path_buf(), parent.parent().map(|p| p.to_path_buf()))
            } else {
                results.push(ReimportResult { item_id: id, name, status: "skipped".into(), message: "unknown directory structure".into() });
                continue;
            }
        };

        let archive = match cache_dir_opt.as_deref().and_then(find_archive_in_dir) {
            Some(a) => a,
            None    => { results.push(ReimportResult { item_id: id, name, status: "skipped".into(), message: "no source archive found alongside extracted dir".into() }); continue; }
        };

        // Borrar y recrear extracted_root
        if let Err(e) = std::fs::remove_dir_all(&extracted_root) {
            results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("failed to delete extracted dir: {e}") });
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(&extracted_root) {
            results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("failed to recreate extracted dir: {e}") });
            continue;
        }

        let archive_clone   = archive.clone();
        let exroot_clone    = extracted_root.clone();
        let extract_result  = tokio::task::spawn_blocking(move || {
            extract_archive_to(&archive_clone, &exroot_clone)
        }).await;

        match extract_result {
            Ok(Ok(resolved_path)) => {
                // Also extract any .unitypackage files found inside the ZIP.
                extract_unity_packages_in_dir(&resolved_path);
                results.push(ReimportResult { item_id: id, name, status: "ok".into(), message: format!("re-extracted from {}", archive.file_name().unwrap_or_default().to_string_lossy()) });
            }
            Ok(Err(e)) => results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("extraction failed: {e}") }),
            Err(e)     => results.push(ReimportResult { item_id: id, name, status: "error".into(), message: format!("task panic: {e}") }),
        }
    }

    Ok(results)
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateItemMetadataPayload {
    pub item_id:      String,
    pub display_name: Option<String>,
    pub tags:         Option<Vec<String>>,
}

#[tauri::command]
pub async fn update_item_metadata(
    pool: State<'_, SqlitePool>,
    payload: UpdateItemMetadataPayload,
) -> Result<(), AppError> {
    if let Some(dn) = &payload.display_name {
        sqlx::query("UPDATE inventory_items SET display_name = ? WHERE id = ?")
            .bind(dn)
            .bind(&payload.item_id)
            .execute(&*pool)
            .await?;
    }
    if let Some(tags) = &payload.tags {
        let tags_json = serde_json::to_string(tags)
            .map_err(|e| AppError::External(e.to_string()))?;
        sqlx::query("UPDATE inventory_items SET tags = ? WHERE id = ?")
            .bind(&tags_json)
            .bind(&payload.item_id)
            .execute(&*pool)
            .await?;
    }
    Ok(())
}

/// Copia la imagen elegida por el usuario a <app_data>/covers/<item_id>.<ext>
/// y guarda la ruta resultante en custom_cover_path.
#[tauri::command]
pub async fn set_item_custom_cover(
    pool:       State<'_, SqlitePool>,
    app_handle: tauri::AppHandle,
    item_id:    String,
    source_path: String,
) -> Result<String, AppError> {
    let src = std::path::Path::new(&source_path);
    let ext = src.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    // Directorio de portadas dentro de app data
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir)
        .map_err(|e| AppError::External(e.to_string()))?;

    let dest = covers_dir.join(format!("{}.{}", item_id, ext));
    std::fs::copy(src, &dest)
        .map_err(|e| AppError::External(e.to_string()))?;

    let dest_str = dest.to_string_lossy().to_string();
    sqlx::query("UPDATE inventory_items SET custom_cover_path = ? WHERE id = ?")
        .bind(&dest_str)
        .bind(&item_id)
        .execute(&*pool)
        .await?;

    Ok(dest_str)
}

#[tauri::command]
pub async fn reorder_items(
    pool:     State<'_, SqlitePool>,
    item_ids: Vec<String>,
) -> Result<(), AppError> {
    for (idx, id) in item_ids.iter().enumerate() {
        sqlx::query("UPDATE inventory_items SET sort_order = ? WHERE id = ?")
            .bind(idx as i32)
            .bind(id)
            .execute(&*pool)
            .await?;
    }
    Ok(())
}

// ── Sustituye las funciones problemáticas ──

#[tauri::command]
pub async fn set_item_custom_images(
    app_handle: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    item_id: String,
    source_paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir)?;

    let mut saved: Vec<String> = Vec::new();
    for src in &source_paths {
        let ext = std::path::Path::new(src)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let filename = format!("{}-{}.{}", item_id, uuid::Uuid::new_v4(), ext);
        let dest = covers_dir.join(&filename);
        std::fs::copy(src, &dest)?;
        saved.push(dest.to_string_lossy().to_string());
    }

    let json = serde_json::to_string(&saved).unwrap_or_else(|_| "[]".to_string());
    let cover = saved.first().cloned();

    sqlx::query(
        "UPDATE inventory_items SET custom_images = ?, custom_cover_path = ? WHERE id = ?"
    )
    .bind(&json)
    .bind(&cover)
    .bind(&item_id)
    .execute(&*pool)
    .await?;

    Ok(saved)
}

#[tauri::command]
pub async fn update_folder(
    app_handle: tauri::AppHandle,
    pool: State<'_, SqlitePool>,
    folder_id: String,
    name: Option<String>,
    color: Option<String>,
    image_source_path: Option<String>,
    clear_image: Option<bool>,
) -> Result<InventoryFolder, AppError> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    let folder_covers_dir = data_dir.join("folder_covers");
    std::fs::create_dir_all(&folder_covers_dir)?;

    // Si el usuario pidió borrar la imagen, limpiar antes de cualquier otra operación
    if clear_image.unwrap_or(false) {
        sqlx::query("UPDATE inventory_folders SET custom_image_path = NULL WHERE id = ?")
            .bind(&folder_id)
            .execute(&*pool)
            .await?;
    }

    let saved_image: Option<String> = if let Some(src) = &image_source_path {
        let ext = std::path::Path::new(src)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let dest = folder_covers_dir.join(format!("{}.{}", folder_id, ext));
        std::fs::copy(src, &dest)?;
        Some(dest.to_string_lossy().to_string())
    } else {
        None
    };

    if let Some(n) = &name {
        sqlx::query("UPDATE inventory_folders SET name = ? WHERE id = ?")
            .bind(n)
            .bind(&folder_id)
            .execute(&*pool)
            .await?;
    }
    if let Some(c) = &color {
        sqlx::query("UPDATE inventory_folders SET color = ? WHERE id = ?")
            .bind(c)
            .bind(&folder_id)
            .execute(&*pool)
            .await?;
    }
    if let Some(img) = &saved_image {
        sqlx::query("UPDATE inventory_folders SET custom_image_path = ? WHERE id = ?")
            .bind(img)
            .bind(&folder_id)
            .execute(&*pool)
            .await?;
    }

    let row = sqlx::query("SELECT * FROM inventory_folders WHERE id = ?")
        .bind(&folder_id)
        .fetch_one(&*pool)
        .await?;
    Ok(row_to_folder(&row))
}

// ── Nuevo comando para eliminar carpetas ──
#[tauri::command]
pub async fn delete_inventory_folder(
    pool: State<'_, SqlitePool>,
    folder_id: String,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM inventory_folders WHERE id = ?")
        .bind(&folder_id)
        .execute(&*pool)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn reset_all_folder_assignments(
    pool: State<'_, SqlitePool>,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM inventory_folder_items")
        .execute(&*pool)
        .await?;
    Ok(())
}

// ── Backup & Restore ────────────────────────────────────────────────────────

use serde_json::Value;

#[tauri::command]
pub async fn export_database_data(
    pool: State<'_, SqlitePool>,
) -> Result<String, AppError> {
    let mut data = serde_json::Map::new();

    // inventory_items
    let rows = sqlx::query("SELECT * FROM inventory_items")
        .fetch_all(&*pool).await?;
    let items: Vec<Value> = rows.iter().map(|r| {
        let mut map = serde_json::Map::new();
        for col in ["id","name","author","source","source_id","local_path","thumbnail_url","download_date","size_bytes","tags","is_compressed","display_name","custom_cover_path","sort_order","product_images","custom_images"] {
            let val: Option<String> = r.try_get(col).ok().flatten();
            map.insert(col.into(), serde_json::to_value(val).unwrap_or(Value::Null));
        }
        Value::Object(map)
    }).collect();
    data.insert("inventory_items".into(), Value::Array(items));

    // inventory_folders
    let rows = sqlx::query("SELECT * FROM inventory_folders")
        .fetch_all(&*pool).await?;
    let folders: Vec<Value> = rows.iter().map(|r| {
        let mut map = serde_json::Map::new();
        for col in ["id","name","parent_id","color","custom_image_path"] {
            let val: Option<String> = r.try_get(col).ok().flatten();
            map.insert(col.into(), serde_json::to_value(val).unwrap_or(Value::Null));
        }
        Value::Object(map)
    }).collect();
    data.insert("inventory_folders".into(), Value::Array(folders));

    // inventory_folder_items
    let rows = sqlx::query("SELECT folder_id, item_id FROM inventory_folder_items")
        .fetch_all(&*pool).await?;
    let folder_items: Vec<Value> = rows.iter().map(|r| {
        let mut map = serde_json::Map::new();
        let fid: String = r.get("folder_id");
        let iid: String = r.get("item_id");
        map.insert("folder_id".into(), Value::String(fid));
        map.insert("item_id".into(), Value::String(iid));
        Value::Object(map)
    }).collect();
    data.insert("inventory_folder_items".into(), Value::Array(folder_items));

    Ok(serde_json::to_string_pretty(&Value::Object(data))
        .map_err(|e| AppError::External(e.to_string()))?)
}

#[tauri::command]
pub async fn import_database_data(
    pool: State<'_, SqlitePool>,
    json: String,
) -> Result<(), AppError> {
    let data: Value = serde_json::from_str(&json)
        .map_err(|e| AppError::External(e.to_string()))?;
    let obj = data.as_object()
        .ok_or(AppError::External("invalid JSON".into()))?;

    // Clear tables (respect FK)
    sqlx::query("DELETE FROM inventory_folder_items").execute(&*pool).await?;
    sqlx::query("DELETE FROM inventory_items").execute(&*pool).await?;
    sqlx::query("DELETE FROM inventory_folders").execute(&*pool).await?;

    // Insert folders first
    if let Some(arr) = obj.get("inventory_folders").and_then(|v| v.as_array()) {
        for v in arr {
            let o = v.as_object().ok_or(AppError::External("invalid folder".into()))?;
            let id = o["id"].as_str().unwrap_or("");
            let name = o["name"].as_str().unwrap_or("");
            let parent_id = o["parent_id"].as_str().map(|s| s.to_string());
            let color = o["color"].as_str().map(|s| s.to_string());
            let custom_image_path = o["custom_image_path"].as_str().map(|s| s.to_string());
            sqlx::query(
                "INSERT INTO inventory_folders (id, name, parent_id, color, custom_image_path) VALUES (?,?,?,?,?)"
            ).bind(id).bind(name).bind(parent_id).bind(color).bind(custom_image_path)
            .execute(&*pool).await?;
        }
    }

    // Insert items
    if let Some(arr) = obj.get("inventory_items").and_then(|v| v.as_array()) {
        for v in arr {
            let o = v.as_object().ok_or(AppError::External("invalid item".into()))?;
            let id = o["id"].as_str().unwrap_or("");
            let name = o["name"].as_str().unwrap_or("");
            let author = o["author"].as_str().map(|s| s.to_string());
            let source = o["source"].as_str().unwrap_or("local");
            let source_id = o["source_id"].as_str().map(|s| s.to_string());
            let local_path = o["local_path"].as_str().unwrap_or("");
            let thumbnail_url = o["thumbnail_url"].as_str().map(|s| s.to_string());
            let download_date = o["download_date"].as_str().unwrap_or("");
            let size_bytes: Option<i64> = o["size_bytes"].as_i64();
            let tags = o["tags"].as_str().unwrap_or("[]");
            let is_compressed = o["is_compressed"].as_i64().unwrap_or(0);
            let display_name = o["display_name"].as_str().map(|s| s.to_string());
            let custom_cover_path = o["custom_cover_path"].as_str().map(|s| s.to_string());
            let sort_order: Option<i64> = o["sort_order"].as_i64();
            let product_images = o["product_images"].as_str().unwrap_or("[]");
            let custom_images = o["custom_images"].as_str().unwrap_or("[]");

            sqlx::query(
                "INSERT INTO inventory_items (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags, is_compressed, display_name, custom_cover_path, sort_order, product_images, custom_images) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            ).bind(id).bind(name).bind(author).bind(source).bind(source_id).bind(local_path).bind(thumbnail_url).bind(download_date).bind(size_bytes).bind(tags).bind(is_compressed).bind(display_name).bind(custom_cover_path).bind(sort_order).bind(product_images).bind(custom_images)
            .execute(&*pool).await?;
        }
    }

    // Insert folder items
    if let Some(arr) = obj.get("inventory_folder_items").and_then(|v| v.as_array()) {
        for v in arr {
            let o = v.as_object().ok_or(AppError::External("invalid folder_item".into()))?;
            let folder_id = o["folder_id"].as_str().unwrap_or("");
            let item_id = o["item_id"].as_str().unwrap_or("");
            sqlx::query("INSERT INTO inventory_folder_items (folder_id, item_id) VALUES (?,?)")
                .bind(folder_id).bind(item_id)
                .execute(&*pool).await?;
        }
    }

    Ok(())
}

// ── Duplicate detection ────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct CheckDuplicateResult {
    pub exists: bool,
    pub existing_item_ids: Vec<String>,
}

#[tauri::command]
pub async fn check_duplicate_items(
    pool: State<'_, SqlitePool>,
    name: String,
    zip_path: Option<String>,
) -> Result<CheckDuplicateResult, AppError> {
    let mut ids: Vec<String> = vec![];
    if let Some(ref zip) = zip_path {
        let rows = sqlx::query("SELECT id FROM inventory_items WHERE name = ? OR local_path LIKE ?")
            .bind(&name)
            .bind(format!("%{}%", zip))
            .fetch_all(&*pool).await?;
        ids = rows.iter().map(|r| r.get("id")).collect();
    } else {
        let rows = sqlx::query("SELECT id FROM inventory_items WHERE name = ?")
            .bind(&name)
            .fetch_all(&*pool).await?;
        ids = rows.iter().map(|r| r.get("id")).collect();
    }
    Ok(CheckDuplicateResult { exists: !ids.is_empty(), existing_item_ids: ids })
}
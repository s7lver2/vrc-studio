// src-tauri/src/commands/inventory.rs

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::{InventoryFolder, InventoryItem, InventorySource};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use uuid::Uuid;

// ── DB row → model conversion (rusqlite version) ─────────────────────────

/// Convierte una fila de `inventory_items` en un `InventoryItem`.
/// Asume que la fila contiene todas las columnas definidas en el esquema actual.
fn row_to_item(row: &rusqlite::Row<'_>) -> InventoryItem {
    let source_str: String = row.get("source").unwrap_or_else(|_| "local".to_string());
    let source = match source_str.as_str() {
        "booth" => InventorySource::Booth,
        _ => InventorySource::Local,
    };

    let tags_json: String = row.get("tags").unwrap_or_else(|_| "[]".to_string());
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

    let product_images_str: String = row
        .get("product_images")
        .unwrap_or_else(|_| "[]".to_string());
    let product_images: Vec<String> = serde_json::from_str(&product_images_str).unwrap_or_default();

    let custom_images_str: String = row
        .get("custom_images")
        .unwrap_or_else(|_| "[]".to_string());
    let custom_images: Vec<String> = serde_json::from_str(&custom_images_str).unwrap_or_default();

    let is_compressed_int: i64 = row.get("is_compressed").unwrap_or(0);
    let is_compressed = is_compressed_int != 0;

    InventoryItem {
        id: row.get("id").unwrap_or_default(),
        name: row.get("name").unwrap_or_default(),
        author: row.get("author").ok(),
        source,
        source_id: row.get("source_id").ok(),
        local_path: row.get("local_path").unwrap_or_default(),
        thumbnail_url: row.get("thumbnail_url").ok(),
        download_date: row.get("download_date").unwrap_or_default(),
        size_bytes: row.get("size_bytes").ok(),
        tags,
        is_compressed,
        display_name: row.get("display_name").ok(),
        custom_cover_path: row.get("custom_cover_path").ok(),
        sort_order: row.get("sort_order").ok(),
        product_images,
        custom_images,
        folder_id: row.get("folder_id").ok(),
        is_multi_avatar: row.get::<_, bool>("is_multi_avatar").unwrap_or(false),
    }
}

/// Convierte una fila de `inventory_folders` en un `InventoryFolder`.
fn row_to_folder(row: &rusqlite::Row<'_>) -> InventoryFolder {
    InventoryFolder {
        id: row.get("id").unwrap_or_default(),
        name: row.get("name").unwrap_or_default(),
        parent_id: row.get("parent_id").ok(),
        color: row.get("color").ok(),
        custom_image_path: row.get("custom_image_path").ok(),
        sort_order: row.get("sort_order").ok(),
        emoji: row.get("emoji").ok(),
        custom_image_fill: row.get("custom_image_fill").ok(),
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

// ── Internal query helpers (sync) ──────────────────────────────────────────

pub fn list_inventory_items_query(pool: &DbPool) -> Result<Vec<InventoryItem>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT i.id, i.name, i.author, i.source, i.source_id, i.local_path, i.thumbnail_url,
                i.download_date, i.size_bytes, i.tags, i.is_compressed,
                i.display_name, i.custom_cover_path, i.sort_order,
                COALESCE(i.product_images, '[]') as product_images,
                COALESCE(i.custom_images, '[]') as custom_images,
                fi.folder_id as folder_id
         FROM inventory_items i
         LEFT JOIN inventory_folder_items fi ON fi.item_id = i.id
         ORDER BY COALESCE(i.sort_order, 999999999), i.download_date DESC",
    )?;
    let items = stmt
        .query_map([], |row| Ok(row_to_item(row)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn delete_inventory_item_query(
    pool: &DbPool,
    item_id: &str,
    mode: DeleteMode,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Obtener la ruta local antes de borrar
    let local_path: Option<String> = conn
        .query_row(
            "SELECT local_path FROM inventory_items WHERE id = ?1",
            params![item_id],
            |row| row.get(0),
        )
        .optional()?;

    let path = match local_path {
        Some(p) => p,
        None => return Err(AppError::NotFound(item_id.to_string())),
    };

    // Borrar archivos del disco según el modo
    match mode {
        DeleteMode::InventoryOnly => {}
        DeleteMode::InventoryAndDisk => {
            remove_from_disk(&path)?;
        }
        DeleteMode::InventoryDiskAndProjects => {
            remove_from_disk(&path)?;
            // Aquí también se podrían eliminar referencias en proyectos, si existiera esa relación
        }
    }

    // Eliminar de la base de datos
    conn.execute(
        "DELETE FROM inventory_items WHERE id = ?1",
        params![item_id],
    )?;
    Ok(())
}

fn remove_from_disk(path: &str) -> Result<(), AppError> {
    let p = Path::new(path);
    if p.exists() {
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(|e| AppError::External(e.to_string()))?;
        } else {
            std::fs::remove_file(p).map_err(|e| AppError::External(e.to_string()))?;
        }
    }
    Ok(())
}

pub fn create_folder_query(
    pool: &DbPool,
    name: &str,
    parent_id: Option<&str>,
) -> Result<String, AppError> {
    let conn = pool.get()?;
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO inventory_folders (id, name, parent_id) VALUES (?1, ?2, ?3)",
        params![id, name, parent_id],
    )?;
    Ok(id)
}

pub fn list_folders_query(pool: &DbPool) -> Result<Vec<InventoryFolder>, AppError> {
    let conn = pool.get()?;
    // Check if 'emoji' column exists
    let has_emoji: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('inventory_folders') WHERE name = 'emoji'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0)
        > 0;

    let sql = if has_emoji {
        "SELECT id, name, parent_id, color, custom_image_path, sort_order, emoji
         FROM inventory_folders
         ORDER BY COALESCE(sort_order, 999999999), name"
    } else {
        "SELECT id, name, parent_id, color, custom_image_path, sort_order
         FROM inventory_folders
         ORDER BY COALESCE(sort_order, 999999999), name"
    };

    let mut stmt = conn.prepare(sql)?;
    let folders = stmt
        .query_map([], |row| {
            if has_emoji {
                Ok(row_to_folder(row))
            } else {
                Ok(InventoryFolder {
                    id: row.get("id").unwrap_or_default(),
                    name: row.get("name").unwrap_or_default(),
                    parent_id: row.get("parent_id").ok(),
                    color: row.get("color").ok(),
                    custom_image_path: row.get("custom_image_path").ok(),
                    sort_order: row.get("sort_order").ok(),
                    emoji: None,
                    custom_image_fill: None,
                })
            }
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}

pub fn move_item_to_folder_query(
    pool: &DbPool,
    item_id: &str,
    folder_id: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    // Eliminar cualquier asignación previa
    conn.execute(
        "DELETE FROM inventory_folder_items WHERE item_id = ?1",
        params![item_id],
    )?;
    if let Some(fid) = folder_id {
        conn.execute(
            "INSERT INTO inventory_folder_items (folder_id, item_id) VALUES (?1, ?2)",
            params![fid, item_id],
        )?;
    }
    Ok(())
}

pub fn tag_inventory_item_query(
    pool: &DbPool,
    item_id: &str,
    tags: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let tags_json = serde_json::to_string(&tags).map_err(|e| AppError::External(e.to_string()))?;
    conn.execute(
        "UPDATE inventory_items SET tags = ?1 WHERE id = ?2",
        params![tags_json, item_id],
    )?;
    Ok(())
}

pub fn set_item_product_images_query(
    pool: &DbPool,
    item_id: &str,
    images: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let json = serde_json::to_string(&images).map_err(|e| AppError::External(e.to_string()))?;
    conn.execute(
        "UPDATE inventory_items SET product_images = ?1 WHERE id = ?2",
        params![json, item_id],
    )?;
    Ok(())
}

pub fn get_item_product_images_query(
    pool: &DbPool,
    item_id: &str,
) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let raw: Option<String> = conn
        .query_row(
            "SELECT product_images FROM inventory_items WHERE id = ?1",
            params![item_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default())
}

// ── Tauri Commands (async, but call sync helpers) ─────────────────────────

#[tauri::command]
pub async fn list_inventory(pool: State<'_, DbPool>) -> Result<Vec<InventoryItem>, AppError> {
    list_inventory_items_query(&pool)
}

#[tauri::command]
pub async fn delete_inventory_item(
    pool: State<'_, DbPool>,
    item_id: String,
    mode: DeleteMode,
) -> Result<(), AppError> {
    delete_inventory_item_query(&pool, &item_id, mode)
}

#[tauri::command]
pub async fn create_inventory_folder(
    pool: State<'_, DbPool>,
    name: String,
    parent_id: Option<String>,
) -> Result<String, AppError> {
    create_folder_query(&pool, &name, parent_id.as_deref())
}

#[tauri::command]
pub async fn list_inventory_folders(
    pool: State<'_, DbPool>,
) -> Result<Vec<InventoryFolder>, AppError> {
    list_folders_query(&pool)
}

#[tauri::command]
pub async fn move_item_to_folder(
    pool: State<'_, DbPool>,
    item_id: String,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    move_item_to_folder_query(&pool, &item_id, folder_id.as_deref())
}

#[tauri::command]
pub async fn tag_inventory_item(
    pool: State<'_, DbPool>,
    item_id: String,
    tags: Vec<String>,
) -> Result<(), AppError> {
    tag_inventory_item_query(&pool, &item_id, tags)
}

#[tauri::command]
pub async fn set_item_product_images(
    pool: State<'_, DbPool>,
    item_id: String,
    images: Vec<String>,
) -> Result<(), AppError> {
    set_item_product_images_query(&pool, &item_id, images)
}

#[tauri::command]
pub async fn get_item_product_images(
    pool: State<'_, DbPool>,
    item_id: String,
) -> Result<Vec<String>, AppError> {
    get_item_product_images_query(&pool, &item_id)
}

// ── File tree (sin cambios) ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub extension: Option<String>,
    pub children: Option<Vec<FileNode>>,
}

const UNITY_SKIP_DIRS: &[&str] = &[
    "Library",
    "Temp",
    "Logs",
    "obj",
    "Builds",
    "Build",
    "UserSettings",
    ".vs",
    ".idea",
    ".git",
    "__pycache__",
];

const UNITY_SKIP_EXTS: &[&str] = &[
    "meta",
    "csproj",
    "sln",
    "user",
    "suo",
    "tmp",
    "pidb",
    "userprefs",
    "unityproj",
];

const UNITY_SKIP_FILES: &[&str] = &[".DS_Store", "Thumbs.db", "desktop.ini"];

fn should_skip(entry_name: &str, is_dir: bool, ext: Option<&str>) -> bool {
    if is_dir {
        return UNITY_SKIP_DIRS.contains(&entry_name);
    }
    if UNITY_SKIP_FILES.contains(&entry_name) {
        return true;
    }
    if let Some(e) = ext {
        return UNITY_SKIP_EXTS.contains(&e);
    }
    false
}

fn build_file_tree(path: &Path, depth: u32) -> FileNode {
    let name = path
        .file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .to_string();
    let full_path = path.to_string_lossy().to_string();

    if path.is_dir() && depth < 6 {
        let children = std::fs::read_dir(path)
            .map(|entries| {
                let mut nodes: Vec<FileNode> = entries
                    .filter_map(|e| e.ok())
                    .filter_map(|e| {
                        let p = e.path();
                        let entry_name = p
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let is_dir = p.is_dir();
                        let ext = p.extension().map(|ex| ex.to_string_lossy().to_lowercase());
                        if should_skip(&entry_name, is_dir, ext.as_deref()) {
                            None
                        } else {
                            Some(build_file_tree(&p, depth + 1))
                        }
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
        let extension = path.extension().map(|e| e.to_string_lossy().to_lowercase());
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
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("Path not found: {}", path));
    }
    tokio::task::spawn_blocking(move || build_file_tree(&p, 0))
        .await
        .map_err(|e| format!("Tree build task failed: {e}"))
}

#[tauri::command]
pub fn open_item_location(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let target = if p.is_file() {
        p.parent().unwrap_or(p)
    } else {
        p
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

// ── UnityPackage reader (sin cambios) ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnityAsset {
    pub guid: String,
    pub asset_path: String,
    pub has_asset_file: bool,
    pub size: Option<u64>,
}

#[tauri::command]
pub fn read_unitypackage(path: String) -> Result<Vec<UnityAsset>, String> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    use tar::Archive;

    let file = std::fs::File::open(&path).map_err(|e| format!("Cannot open file: {}", e))?;
    let gz = GzDecoder::new(file);
    let mut archive = Archive::new(gz);

    let mut pathnames = std::collections::HashMap::new();
    let mut asset_sizes = std::collections::HashMap::new();

    let entries = archive
        .entries()
        .map_err(|e| format!("Cannot read archive: {}", e))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Entry error: {}", e))?;
        let entry_path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let parts: Vec<_> = entry_path.components().collect();
        if parts.len() < 2 {
            continue;
        }
        let guid = parts[0].as_os_str().to_string_lossy().to_string();
        let file_name = parts[parts.len() - 1]
            .as_os_str()
            .to_string_lossy()
            .to_string();
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
        .map(|(guid, asset_path)| UnityAsset {
            has_asset_file: asset_sizes.contains_key(&guid),
            size: asset_sizes.get(&guid).copied(),
            guid,
            asset_path,
        })
        .collect();
    assets.sort_by(|a, b| a.asset_path.cmp(&b.asset_path));
    Ok(assets)
}

// ── Import local package (async, with DB sync calls) ───────────────────────

fn extract_unity_packages_in_dir(dir: &Path) {
    fn walk(dir: &Path, depth: u32) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < 3 {
                    walk(&path, depth + 1);
                }
            } else {
                let is_pkg = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.eq_ignore_ascii_case("unitypackage"))
                    .unwrap_or(false);
                if is_pkg {
                    let parent = path.parent().unwrap_or(dir);
                    if let Err(e) =
                        crate::services::downloader::extract_unitypackage_to_dir(&path, parent)
                    {
                        eprintln!("[import] failed to extract {:?}: {}", path, e);
                    }
                }
            }
        }
    }
    walk(dir, 0);
}

#[tauri::command]
pub async fn import_local_package(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
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

    let item_id = Uuid::new_v4().to_string();
    let cache_dir = crate::commands::app_settings::get_assets_root(&app)
        .join("local")
        .join(&item_id);
    std::fs::create_dir_all(&cache_dir).map_err(|e| AppError::External(e.to_string()))?;

    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("zip");
    let dest = cache_dir.join(format!("{}.{}", &item_id[..8], ext));
    std::fs::copy(src, &dest).map_err(|e| AppError::External(format!("Copy failed: {}", e)))?;

    let final_path = if ext.eq_ignore_ascii_case("zip") {
        let extract_dir = cache_dir.join("extracted");
        std::fs::create_dir_all(&extract_dir).map_err(|e| AppError::External(e.to_string()))?;
        let dest_clone = dest.clone();
        let extract_dir_clone = extract_dir.clone();
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let file = std::fs::File::open(&dest_clone).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            for i in 0..archive.len() {
                let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
                let out_path = match entry.enclosed_name() {
                    Some(p) => extract_dir_clone.join(p),
                    None => continue,
                };
                if entry.is_dir() {
                    std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
                } else {
                    if let Some(parent) = out_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let mut out = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                    std::thread::yield_now();
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| AppError::External(e.to_string()))?
        .map_err(AppError::External)?;

        let entries: Vec<_> = std::fs::read_dir(&extract_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        let final_extract = if entries.len() == 1 {
            let entry_path = entries[0].path();
            if entry_path.is_dir() {
                entry_path
            } else {
                extract_dir.clone()
            }
        } else {
            extract_dir.clone()
        };
        extract_unity_packages_in_dir(&final_extract);
        final_extract
    } else if ext.eq_ignore_ascii_case("unitypackage") {
        let extract_dir = cache_dir.join("extracted");
        std::fs::create_dir_all(&extract_dir).map_err(|e| AppError::External(e.to_string()))?;
        crate::services::downloader::extract_unitypackage_to_dir(&dest, &extract_dir)
            .map_err(|e| AppError::External(e.to_string()))?;
        let entries: Vec<_> = std::fs::read_dir(&extract_dir)
            .map(|rd| rd.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        if entries.len() == 1 {
            let entry_path = entries[0].path();
            if entry_path.is_dir() {
                entry_path
            } else {
                extract_dir
            }
        } else {
            extract_dir
        }
    } else {
        dest
    };

    let now = chrono::Utc::now().to_rfc3339();
    let local_path = final_path.to_string_lossy().to_string();
    let size_bytes = std::fs::metadata(src).map(|m| m.len() as i64).unwrap_or(0);

    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags)
         VALUES (?1, ?2, ?3, 'local', ?4, ?5, ?6, ?7, ?8, '[]')",
        params![item_id, name, author, booth_id, local_path, thumbnail_url, now, size_bytes],
    )?;

    Ok(item_id)
}

// ── Compression (async, with DB sync calls) ────────────────────────────────

#[tauri::command]
pub async fn compress_item(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
    item_id: String,
) -> Result<(), AppError> {
    use tauri::Emitter;

    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT local_path, is_compressed FROM inventory_items WHERE id = ?1",
            params![item_id],
            |row| -> Result<(String, i64), rusqlite::Error> { Ok((row.get(0)?, row.get(1)?)) },
        )
        .optional()?;
    let (local_path, is_compressed) =
        row.ok_or_else(|| AppError::NotFound(format!("InventoryItem {}", item_id)))?;

    if is_compressed != 0 {
        return Ok(());
    }

    let src = Path::new(&local_path);
    if !src.exists() {
        return Err(AppError::External(format!(
            "Path not found: {}",
            local_path
        )));
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

        let zip_file = std::fs::File::create(&zip_path_clone).map_err(|e| e.to_string())?;
        let mut writer = zip::ZipWriter::new(zip_file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(9));

        let src_path = Path::new(&local_path_clone);
        let mut all_files = Vec::new();
        if src_path.is_dir() {
            for entry in walkdir::WalkDir::new(src_path)
                .into_iter()
                .filter_map(|e| e.ok())
            {
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
                let stripped = file_path
                    .strip_prefix(src_path)
                    .unwrap_or(file_path)
                    .to_string_lossy()
                    .replace('\\', "/");
                if stripped.is_empty() {
                    file_path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                } else {
                    stripped
                }
            };
            writer
                .start_file(&rel, options)
                .map_err(|e| e.to_string())?;
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

    let conn = pool.get()?;
    conn.execute(
        "UPDATE inventory_items SET local_path = ?1, is_compressed = 1 WHERE id = ?2",
        params![zip_path, item_id],
    )?;

    let _ = app.emit(
        "compress://progress",
        serde_json::json!({ "item_id": item_id, "percentage": 100.0, "phase": "done" }),
    );
    Ok(())
}

#[tauri::command]
pub async fn decompress_item(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
    item_id: String,
) -> Result<(), AppError> {
    use tauri::Emitter;

    let conn = pool.get()?;
    let row = conn
        .query_row(
            "SELECT local_path, is_compressed FROM inventory_items WHERE id = ?1",
            params![item_id],
            |row| -> Result<(String, i64), rusqlite::Error> { Ok((row.get(0)?, row.get(1)?)) },
        )
        .optional()?;
    let (zip_path, is_compressed) =
        row.ok_or_else(|| AppError::NotFound(format!("InventoryItem {}", item_id)))?;

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
            let out_path = Path::new(&original_path_clone).join(zip_file.mangled_name());
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

    let conn = pool.get()?;
    conn.execute(
        "UPDATE inventory_items SET local_path = ?1, is_compressed = 0 WHERE id = ?2",
        params![original_path, item_id],
    )?;

    let _ = app.emit(
        "compress://progress",
        serde_json::json!({ "item_id": item_id, "percentage": 100.0, "phase": "done" }),
    );
    Ok(())
}

// ── Reimport all assets (async) ────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
pub struct ReimportResult {
    pub item_id: String,
    pub name: String,
    pub status: String,
    pub message: String,
}

fn find_archive_in_dir(dir: &Path) -> Option<std::path::PathBuf> {
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_file() {
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext == "zip" || ext == "unitypackage" {
                return Some(p);
            }
        }
    }
    None
}

fn extract_archive_to(archive: &Path, extract_dir: &Path) -> Result<std::path::PathBuf, String> {
    let ext = archive
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "zip" {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut a = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        a.extract(extract_dir).map_err(|e| e.to_string())?;
    } else if ext == "unitypackage" {
        crate::services::downloader::extract_unitypackage_to_dir(archive, extract_dir)
            .map_err(|e| e.to_string())?;
    } else {
        return Err(format!("unsupported archive format: {ext}"));
    }

    let entries: Vec<_> = std::fs::read_dir(extract_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).collect())
        .unwrap_or_default();
    if entries.len() == 1 {
        let entry_path = entries[0].path();
        if entry_path.is_dir() {
            return Ok(entry_path);
        }
    }
    Ok(extract_dir.to_path_buf())
}

#[tauri::command]
pub async fn reimport_all_assets(pool: State<'_, DbPool>) -> Result<Vec<ReimportResult>, String> {
    // Leer todos los items en memoria primero (sin mantener stmt/conn vivos)
    let items = {
        let conn = pool.get().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, local_path FROM inventory_items")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| e.to_string())?);
        }
        items
    };

    let mut results = Vec::new();
    for (id, name, lpath) in items {
        let lp = Path::new(&lpath);
        if lp.is_file() {
            let ext = lp
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ext != "zip" && ext != "unitypackage" {
                results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "skipped".into(),
                    message: "local_path is a non-archive file".into(),
                });
                continue;
            }

            let extract_dir = match lp.parent() {
                Some(p) => p.join("extracted"),
                None => {
                    results.push(ReimportResult {
                        item_id: id,
                        name,
                        status: "error".into(),
                        message: "cannot determine parent dir".into(),
                    });
                    continue;
                }
            };
            if extract_dir.exists() {
                if let Err(e) = std::fs::remove_dir_all(&extract_dir) {
                    results.push(ReimportResult {
                        item_id: id,
                        name,
                        status: "error".into(),
                        message: format!("failed to clear old extracted dir: {e}"),
                    });
                    continue;
                }
            }
            if let Err(e) = std::fs::create_dir_all(&extract_dir) {
                results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "error".into(),
                    message: format!("failed to create extracted dir: {e}"),
                });
                continue;
            }

            let archive = lp.to_path_buf();
            let extract_dir_clone = extract_dir.clone();
            let extract_result = tokio::task::spawn_blocking(move || {
                extract_archive_to(&archive, &extract_dir_clone)
            })
            .await;

            match extract_result {
                Ok(Ok(new_path)) => {
                    extract_unity_packages_in_dir(&new_path);
                    let new_local_path = new_path.to_string_lossy().to_string();
                    // Nueva conexión para actualizar
                    match pool.get() {
                        Ok(conn2) => {
                            if let Err(e) = conn2.execute(
                                "UPDATE inventory_items SET local_path = ?1 WHERE id = ?2",
                                params![new_local_path, id],
                            ) {
                                results.push(ReimportResult {
                                    item_id: id,
                                    name,
                                    status: "error".into(),
                                    message: format!("extracted but DB update failed: {e}"),
                                });
                            } else {
                                results.push(ReimportResult {
                                    item_id: id,
                                    name,
                                    status: "ok".into(),
                                    message: format!(
                                        "extracted and local_path updated → {new_local_path}"
                                    ),
                                });
                            }
                        }
                        Err(e) => results.push(ReimportResult {
                            item_id: id,
                            name,
                            status: "error".into(),
                            message: format!("DB connection failed: {e}"),
                        }),
                    }
                }
                Ok(Err(e)) => results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "error".into(),
                    message: format!("extraction failed: {e}"),
                }),
                Err(e) => results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "error".into(),
                    message: format!("task panic: {e}"),
                }),
            }
            continue;
        }

        // Caso directorio (similar, reabrir conexión cada vez que se necesite actualizar)
        if !lp.exists() {
            results.push(ReimportResult {
                item_id: id,
                name,
                status: "skipped".into(),
                message: "path does not exist".into(),
            });
            continue;
        }
        if !lp.is_dir() {
            results.push(ReimportResult {
                item_id: id,
                name,
                status: "skipped".into(),
                message: "unknown local_path type".into(),
            });
            continue;
        }

        let dir_name = lp.file_name().and_then(|n| n.to_str()).unwrap_or("");
        let (extracted_root, cache_dir_opt) = if dir_name == "extracted" {
            (lp.to_path_buf(), lp.parent().map(|p| p.to_path_buf()))
        } else {
            let parent = lp.parent().unwrap_or(lp);
            let parent_name = parent.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if parent_name == "extracted" {
                (
                    parent.to_path_buf(),
                    parent.parent().map(|p| p.to_path_buf()),
                )
            } else {
                results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "skipped".into(),
                    message: "unknown directory structure".into(),
                });
                continue;
            }
        };

        let archive = match cache_dir_opt.as_deref().and_then(find_archive_in_dir) {
            Some(a) => a,
            None => {
                results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "skipped".into(),
                    message: "no source archive found alongside extracted dir".into(),
                });
                continue;
            }
        };

        if let Err(e) = std::fs::remove_dir_all(&extracted_root) {
            results.push(ReimportResult {
                item_id: id,
                name,
                status: "error".into(),
                message: format!("failed to delete extracted dir: {e}"),
            });
            continue;
        }
        if let Err(e) = std::fs::create_dir_all(&extracted_root) {
            results.push(ReimportResult {
                item_id: id,
                name,
                status: "error".into(),
                message: format!("failed to recreate extracted dir: {e}"),
            });
            continue;
        }

        let archive_clone = archive.clone();
        let exroot_clone = extracted_root.clone();
        let extract_result =
            tokio::task::spawn_blocking(move || extract_archive_to(&archive_clone, &exroot_clone))
                .await;

        match extract_result {
            Ok(Ok(resolved_path)) => {
                extract_unity_packages_in_dir(&resolved_path);
                results.push(ReimportResult {
                    item_id: id,
                    name,
                    status: "ok".into(),
                    message: format!(
                        "re-extracted from {}",
                        archive.file_name().unwrap_or_default().to_string_lossy()
                    ),
                });
            }
            Ok(Err(e)) => results.push(ReimportResult {
                item_id: id,
                name,
                status: "error".into(),
                message: format!("extraction failed: {e}"),
            }),
            Err(e) => results.push(ReimportResult {
                item_id: id,
                name,
                status: "error".into(),
                message: format!("task panic: {e}"),
            }),
        }
    }
    Ok(results)
}

// ── Metadata updates ────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
pub struct UpdateItemMetadataPayload {
    pub item_id: String,
    pub display_name: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[tauri::command]
pub async fn update_item_metadata(
    pool: State<'_, DbPool>,
    payload: UpdateItemMetadataPayload,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    if let Some(dn) = &payload.display_name {
        conn.execute(
            "UPDATE inventory_items SET display_name = ?1 WHERE id = ?2",
            params![dn, payload.item_id],
        )?;
    }
    if let Some(tags) = &payload.tags {
        let tags_json =
            serde_json::to_string(tags).map_err(|e| AppError::External(e.to_string()))?;
        conn.execute(
            "UPDATE inventory_items SET tags = ?1 WHERE id = ?2",
            params![tags_json, payload.item_id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_item_custom_cover(
    pool: State<'_, DbPool>,
    app_handle: tauri::AppHandle,
    item_id: String,
    source_path: String,
) -> Result<String, AppError> {
    let src = Path::new(&source_path);
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir).map_err(|e| AppError::External(e.to_string()))?;
    let dest = covers_dir.join(format!("{}.{}", item_id, ext));
    std::fs::copy(src, &dest).map_err(|e| AppError::External(e.to_string()))?;
    let dest_str = dest.to_string_lossy().to_string();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE inventory_items SET custom_cover_path = ?1 WHERE id = ?2",
        params![dest_str, item_id],
    )?;
    Ok(dest_str)
}

#[tauri::command]
pub async fn reorder_items(pool: State<'_, DbPool>, item_ids: Vec<String>) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (idx, id) in item_ids.iter().enumerate() {
        conn.execute(
            "UPDATE inventory_items SET sort_order = ?1 WHERE id = ?2",
            params![idx as i32, id],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_item_custom_images(
    app_handle: tauri::AppHandle,
    pool: State<'_, DbPool>,
    item_id: String,
    source_paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    let covers_dir = data_dir.join("covers");
    std::fs::create_dir_all(&covers_dir)?;
    let mut saved = Vec::new();
    for src in &source_paths {
        let ext = Path::new(src)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let filename = format!("{}-{}.{}", item_id, Uuid::new_v4(), ext);
        let dest = covers_dir.join(&filename);
        std::fs::copy(src, &dest)?;
        saved.push(dest.to_string_lossy().to_string());
    }
    let json = serde_json::to_string(&saved).unwrap_or_else(|_| "[]".to_string());
    let cover = saved.first().cloned();
    let conn = pool.get()?;
    conn.execute(
        "UPDATE inventory_items SET custom_images = ?1, custom_cover_path = ?2 WHERE id = ?3",
        params![json, cover, item_id],
    )?;
    Ok(saved)
}

#[tauri::command]
pub async fn update_folder(
    app_handle: tauri::AppHandle,
    pool: State<'_, DbPool>,
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

    if clear_image.unwrap_or(false) {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE inventory_folders SET custom_image_path = NULL WHERE id = ?1",
            params![folder_id],
        )?;
    }

    let saved_image = if let Some(src) = &image_source_path {
        let ext = Path::new(src)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let dest = folder_covers_dir.join(format!("{}.{}", folder_id, ext));
        std::fs::copy(src, &dest)?;
        Some(dest.to_string_lossy().to_string())
    } else {
        None
    };

    let conn = pool.get()?;
    if let Some(n) = name {
        conn.execute(
            "UPDATE inventory_folders SET name = ?1 WHERE id = ?2",
            params![n, folder_id],
        )?;
    }
    if let Some(c) = color {
        conn.execute(
            "UPDATE inventory_folders SET color = ?1 WHERE id = ?2",
            params![c, folder_id],
        )?;
    }
    if let Some(img) = saved_image {
        conn.execute(
            "UPDATE inventory_folders SET custom_image_path = ?1 WHERE id = ?2",
            params![img, folder_id],
        )?;
    }

    // Check if the 'emoji' column exists
    let has_emoji: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('inventory_folders') WHERE name = 'emoji'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0) > 0;

    let folder = if has_emoji {
        conn.query_row(
            "SELECT id, name, parent_id, color, custom_image_path, sort_order, emoji FROM inventory_folders WHERE id = ?1",
            params![folder_id],
            |row| Ok(row_to_folder(row)),
        )?
    } else {
        conn.query_row(
            "SELECT id, name, parent_id, color, custom_image_path, sort_order FROM inventory_folders WHERE id = ?1",
            params![folder_id],
            |row| {
                Ok(InventoryFolder {
                    id: row.get("id").unwrap_or_default(),
                    name: row.get("name").unwrap_or_default(),
                    parent_id: row.get("parent_id").ok(),
                    color: row.get("color").ok(),
                    custom_image_path: row.get("custom_image_path").ok(),
                    sort_order: row.get("sort_order").ok(),
                    emoji: None,
                    custom_image_fill: None,
                })
            },
        )?
    };

    Ok(folder)
}

/// Move a folder to a new parent (or to root when parent_id is None).
/// Guards against self-assignment; does NOT check for deeper cycles
/// (the UI prevents those by not showing a folder as a drop target for its own ancestor).
#[tauri::command]
pub async fn move_folder_to_parent(
    pool: State<'_, DbPool>,
    folder_id: String,
    parent_id: Option<String>,
) -> Result<(), AppError> {
    // Prevent a folder from becoming its own parent
    if parent_id.as_deref() == Some(folder_id.as_str()) {
        return Err(AppError::InvalidInput("A folder cannot contain itself".into()));
    }
    let conn = pool.get()?;
    conn.execute(
        "UPDATE inventory_folders SET parent_id = ?1 WHERE id = ?2",
        params![parent_id, folder_id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn delete_inventory_folder(
    pool: State<'_, DbPool>,
    folder_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "DELETE FROM inventory_folders WHERE id = ?1",
        params![folder_id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn reset_all_folder_assignments(pool: State<'_, DbPool>) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute("DELETE FROM inventory_folder_items", [])?;
    Ok(())
}

// ── Backup & Restore (async) ───────────────────────────────────────────────

use serde_json::Value;

#[tauri::command]
pub async fn export_database_data(pool: State<'_, DbPool>) -> Result<String, AppError> {
    let conn = pool.get()?;
    let mut data = serde_json::Map::new();

    // inventory_items
    let mut stmt = conn.prepare("SELECT * FROM inventory_items")?;
    let rows = stmt.query_map([], |row| {
        let mut map = serde_json::Map::new();
        for col in &[
            "id",
            "name",
            "author",
            "source",
            "source_id",
            "local_path",
            "thumbnail_url",
            "download_date",
            "size_bytes",
            "tags",
            "is_compressed",
            "display_name",
            "custom_cover_path",
            "sort_order",
            "product_images",
            "custom_images",
        ] {
            let val: Option<String> = row.get(*col).ok();
            map.insert(
                col.to_string(),
                serde_json::to_value(val).unwrap_or(Value::Null),
            );
        }
        Ok(Value::Object(map))
    })?;
    let items: Vec<Value> = rows.collect::<Result<_, _>>()?;
    data.insert("inventory_items".into(), Value::Array(items));

    // inventory_folders
    let mut stmt = conn.prepare("SELECT * FROM inventory_folders")?;
    let rows = stmt.query_map([], |row| {
        let mut map = serde_json::Map::new();
        for col in &[
            "id",
            "name",
            "parent_id",
            "color",
            "custom_image_path",
            "sort_order",
            "emoji",
        ] {
            let val: Option<String> = row.get(*col).ok();
            map.insert(
                col.to_string(),
                serde_json::to_value(val).unwrap_or(Value::Null),
            );
        }
        Ok(Value::Object(map))
    })?;
    let folders: Vec<Value> = rows.collect::<Result<_, _>>()?;
    data.insert("inventory_folders".into(), Value::Array(folders));

    // inventory_folder_items
    let mut stmt = conn.prepare("SELECT folder_id, item_id FROM inventory_folder_items")?;
    let rows = stmt.query_map([], |row| {
        let fid: String = row.get(0)?;
        let iid: String = row.get(1)?;
        Ok(serde_json::json!({
            "folder_id": fid,
            "item_id": iid
        }))
    })?;
    let folder_items: Vec<Value> = rows.collect::<Result<_, _>>()?;
    data.insert("inventory_folder_items".into(), Value::Array(folder_items));

    Ok(serde_json::to_string_pretty(&Value::Object(data))
        .map_err(|e| AppError::External(e.to_string()))?)
}

#[tauri::command]
pub async fn import_database_data(pool: State<'_, DbPool>, json: String) -> Result<(), AppError> {
    let data: Value = serde_json::from_str(&json).map_err(|e| AppError::External(e.to_string()))?;
    let obj = data
        .as_object()
        .ok_or(AppError::External("invalid JSON".into()))?;

    let conn = pool.get()?;
    conn.execute("DELETE FROM inventory_folder_items", [])?;
    conn.execute("DELETE FROM inventory_items", [])?;
    conn.execute("DELETE FROM inventory_folders", [])?;

    if let Some(arr) = obj.get("inventory_folders").and_then(|v| v.as_array()) {
        for v in arr {
            let o = v
                .as_object()
                .ok_or(AppError::External("invalid folder".into()))?;
            let id = o.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = o.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let parent_id = o
                .get("parent_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let color = o
                .get("color")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let custom_image_path = o
                .get("custom_image_path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let sort_order = o.get("sort_order").and_then(|v| v.as_i64());
            let emoji = o
                .get("emoji")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            conn.execute(
                "INSERT INTO inventory_folders (id, name, parent_id, color, custom_image_path, sort_order, emoji) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, name, parent_id, color, custom_image_path, sort_order, emoji],
            )?;
        }
    }

    if let Some(arr) = obj.get("inventory_items").and_then(|v| v.as_array()) {
        for v in arr {
            let o = v
                .as_object()
                .ok_or(AppError::External("invalid item".into()))?;
            let id = o.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = o.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let author = o
                .get("author")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let source = o.get("source").and_then(|v| v.as_str()).unwrap_or("local");
            let source_id = o
                .get("source_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let local_path = o.get("local_path").and_then(|v| v.as_str()).unwrap_or("");
            let thumbnail_url = o
                .get("thumbnail_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let download_date = o
                .get("download_date")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let size_bytes = o.get("size_bytes").and_then(|v| v.as_i64());
            let tags = o.get("tags").and_then(|v| v.as_str()).unwrap_or("[]");
            let is_compressed = o.get("is_compressed").and_then(|v| v.as_i64()).unwrap_or(0);
            let display_name = o
                .get("display_name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let custom_cover_path = o
                .get("custom_cover_path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let sort_order = o.get("sort_order").and_then(|v| v.as_i64());
            let product_images = o
                .get("product_images")
                .and_then(|v| v.as_str())
                .unwrap_or("[]");
            let custom_images = o
                .get("custom_images")
                .and_then(|v| v.as_str())
                .unwrap_or("[]");
            conn.execute(
                "INSERT INTO inventory_items (id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags, is_compressed, display_name, custom_cover_path, sort_order, product_images, custom_images) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![id, name, author, source, source_id, local_path, thumbnail_url, download_date, size_bytes, tags, is_compressed, display_name, custom_cover_path, sort_order, product_images, custom_images],
            )?;
        }
    }

    if let Some(arr) = obj.get("inventory_folder_items").and_then(|v| v.as_array()) {
        for v in arr {
            let o = v
                .as_object()
                .ok_or(AppError::External("invalid folder_item".into()))?;
            let folder_id = o.get("folder_id").and_then(|v| v.as_str()).unwrap_or("");
            let item_id = o.get("item_id").and_then(|v| v.as_str()).unwrap_or("");
            conn.execute(
                "INSERT INTO inventory_folder_items (folder_id, item_id) VALUES (?1, ?2)",
                params![folder_id, item_id],
            )?;
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
    pool: State<'_, DbPool>,
    name: String,
    zip_path: Option<String>,
) -> Result<CheckDuplicateResult, AppError> {
    let conn = pool.get()?;
    let mut ids = Vec::new();
    if let Some(zip) = zip_path {
        let mut stmt =
            conn.prepare("SELECT id FROM inventory_items WHERE name = ?1 OR local_path LIKE ?2")?;
        let rows = stmt.query_map(params![name, format!("%{}%", zip)], |row| {
            row.get::<_, String>(0)
        })?;
        ids = rows.collect::<Result<_, _>>()?;
    } else {
        let mut stmt = conn.prepare("SELECT id FROM inventory_items WHERE name = ?1")?;
        let rows = stmt.query_map(params![name], |row| row.get::<_, String>(0))?;
        ids = rows.collect::<Result<_, _>>()?;
    }
    Ok(CheckDuplicateResult {
        exists: !ids.is_empty(),
        existing_item_ids: ids,
    })
}

// ── Unity project launch helpers (no DB) ───────────────────────────────────

fn is_unity_running_for_project(project_path: &str) -> bool {
    use sysinfo::System;
    let norm = |p: &str| p.replace('\\', "/").to_lowercase();
    let target = norm(project_path).trim_end_matches('/').to_string();

    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut found_project_match = false;
    let mut found_editor = false;

    for (_pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_lowercase();
        if name != "unity.exe" && name != "unity" {
            continue;
        }
        found_editor = true;
        let args: Vec<String> = process
            .cmd()
            .iter()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        if let Some(idx) = args.iter().position(|a| a == "-projectPath") {
            if let Some(path) = args.get(idx + 1) {
                if norm(path).trim_end_matches('/') == target {
                    found_project_match = true;
                }
            }
        }
    }
    if found_project_match {
        return true;
    }
    let lock = Path::new(project_path).join("Temp").join("UnityLockfile");
    lock.exists() && found_editor
}

#[tauri::command]
pub async fn launch_unity_for_project(
    project_path: String,
    unity_path: String,
) -> Result<bool, String> {
    let already_running = tokio::task::spawn_blocking({
        let pp = project_path.clone();
        move || is_unity_running_for_project(&pp)
    })
    .await
    .unwrap_or(false);
    if already_running {
        return Ok(true);
    }

    let resolved_path = if unity_path.is_empty() {
        let version_file = Path::new(&project_path)
            .join("ProjectSettings")
            .join("ProjectVersion.txt");
        let version = tokio::fs::read_to_string(&version_file)
            .await
            .ok()
            .and_then(|txt| {
                txt.lines()
                    .find(|l| l.starts_with("m_EditorVersion:"))
                    .map(|l| l.trim_start_matches("m_EditorVersion:").trim().to_owned())
            });
        if let Some(ver) = version {
            let installations = crate::services::unity_detector::detect_unity_installations().await;
            installations
                .into_iter()
                .find(|i| i.version == ver)
                .map(|i| i.path)
                .unwrap_or_default()
        } else {
            String::new()
        }
    } else {
        unity_path
    };

    if resolved_path.is_empty() {
        return Err("No se encontró una instalación de Unity compatible. Abre Unity Hub y asegúrate de tener instalada la versión correcta.".to_string());
    }

    tokio::process::Command::new(&resolved_path)
        .arg("-projectPath")
        .arg(&project_path)
        .spawn()
        .map_err(|e| format!("No se pudo lanzar Unity: {e}"))?;
    Ok(false)
}

#[tauri::command]
pub async fn check_unity_running(project_path: String) -> Result<bool, String> {
    let running = tokio::task::spawn_blocking(move || is_unity_running_for_project(&project_path))
        .await
        .unwrap_or(false);
    Ok(running)
}

async fn open_with_system_handler(path: &str) -> Result<(), String> {
    let path_owned = path.to_string();
    tokio::task::spawn_blocking(move || open::that(&path_owned))
        .await
        .map_err(|e| format!("Error en la tarea de bloqueo: {}", e))?
        .map_err(|e| format!("No se pudo abrir '{}': {}", path, e))
}

fn find_unitypackages(root: &Path) -> Vec<std::path::PathBuf> {
    if root.is_file() {
        if root
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("unitypackage"))
            .unwrap_or(false)
        {
            return vec![root.to_path_buf()];
        }
        return vec![];
    }

    fn collect_in_dir(dir: &Path, depth: u32, out: &mut Vec<std::path::PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth < 3 {
                    collect_in_dir(&path, depth + 1, out);
                }
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("unitypackage"))
                .unwrap_or(false)
            {
                out.push(path);
            }
        }
    }

    let mut found = Vec::new();
    collect_in_dir(root, 0, &mut found);
    if !found.is_empty() {
        return found;
    }

    let mut current = root;
    for _ in 0..3 {
        let Some(parent) = current.parent() else {
            break;
        };
        if let Ok(rd) = std::fs::read_dir(parent) {
            for entry in rd.flatten() {
                let path = entry.path();
                if path.is_file()
                    && path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("unitypackage"))
                        .unwrap_or(false)
                {
                    found.push(path);
                }
            }
        }
        if !found.is_empty() {
            return found;
        }
        current = parent;
    }
    found
}

#[tauri::command]
pub async fn open_single_item_in_unity(
    project_path: String,
    item_path: String,
) -> Result<(), String> {
    let running = tokio::task::spawn_blocking({
        let pp = project_path.clone();
        move || is_unity_running_for_project(&pp)
    })
    .await
    .unwrap_or(false);
    if !running {
        return Err("Unity no está abierto para este proyecto.".to_string());
    }

    let pkgs = find_unitypackages(Path::new(&item_path));
    if pkgs.is_empty() {
        return Err(format!(
            "No se encontró ningún archivo .unitypackage para: {item_path}"
        ));
    }
    for pkg in &pkgs {
        open_with_system_handler(&pkg.to_string_lossy()).await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn import_items_in_unity(
    project_path: String,
    item_paths: Vec<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;
    if item_paths.is_empty() {
        return Ok(());
    }

    let running = tokio::task::spawn_blocking({
        let pp = project_path.clone();
        move || is_unity_running_for_project(&pp)
    })
    .await
    .unwrap_or(false);
    if !running {
        return Err("Unity no está abierto para este proyecto. Espera a que cargue completamente antes de importar.".to_string());
    }

    let mut resolved = Vec::new();
    for path in &item_paths {
        let pkgs = find_unitypackages(Path::new(path));
        if pkgs.is_empty() {
            return Err(format!("No se encontró ningún archivo .unitypackage para: {path}\nComprueba que el item fue importado correctamente."));
        }
        resolved.push(pkgs);
    }

    for pkgs in &resolved {
        for pkg in pkgs {
            open_with_system_handler(&pkg.to_string_lossy()).await?;
            tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
        }
    }

    for (i, path) in item_paths.iter().enumerate() {
        let _ = app.emit(
            "inventory:import_progress",
            serde_json::json!({
                "index": i,
                "total": item_paths.len(),
                "path": path,
                "done": false,
            }),
        );
        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
        let _ = app.emit(
            "inventory:import_progress",
            serde_json::json!({
                "index": i,
                "total": item_paths.len(),
                "path": path,
                "done": true,
            }),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn download_to_temp(app: tauri::AppHandle, url: String) -> Result<String, AppError> {
    use crate::services::downloader;
    let effective_url = if url.contains("pixeldrain.com/l/") || url.contains("pixeldrain.com/u/") {
        let id = url
            .split('/')
            .last()
            .unwrap_or("")
            .split('?')
            .next()
            .unwrap_or("");
        format!("https://pixeldrain.com/api/file/{}", id)
    } else {
        url.clone()
    };

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    let temp_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::External(e.to_string()))?
        .join("url_import_tmp");
    let downloaded_path =
        downloader::download_file(&app, &client, "url-import", &effective_url, &temp_dir)
            .await
            .map_err(AppError::External)?;
    Ok(downloaded_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn reorder_folders(
    pool: State<'_, DbPool>,
    ordered_ids: Vec<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        conn.execute(
            "UPDATE inventory_folders SET sort_order = ?1 WHERE id = ?2",
            params![idx as i32, id],
        )?;
    }
    Ok(())
}

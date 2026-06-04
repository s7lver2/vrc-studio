// src-tauri/src/commands/multi_avatar.rs
use crate::db::DbPool;
use crate::error::AppError;
use crate::models::{ImportMultiAvatarArgs, ItemVariant};
use rusqlite::params;
use std::io::Read;
use std::path::Path;
use tauri::{Manager, State};
use uuid::Uuid;
use zip::ZipArchive;

/// Opens a file for reading in shared mode so other processes can also read it.
/// On Windows this avoids "Access Denied" (os error 5) when the file is already
/// open (e.g., by Explorer, antivirus, or another app instance).
fn open_file_shared(path: &str) -> Result<std::fs::File, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE = 0x7
        // Maximum sharing — allows reading even when Explorer/AV has the file open.
        // Also retries 3× (120 ms apart) to survive transient AV scans.
        let mut last_err = String::new();
        for attempt in 0..3u32 {
            match std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0x00000007)
                .open(path)
            {
                Ok(f) => return Ok(f),
                Err(e) => {
                    last_err = format!("Cannot open zip: {e}");
                    if attempt < 2 {
                        std::thread::sleep(std::time::Duration::from_millis(120));
                    }
                }
            }
        }
        Err(last_err)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::fs::File::open(path).map_err(|e| format!("Cannot open zip: {e}"))
    }
}

/// Lists top-level .zip / .unitypackage entries inside a container zip.
/// Also handles the extracted (directory) case: lists matching files directly.
#[tauri::command]
pub async fn list_zip_contents(zip_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let zip_path_p = std::path::Path::new(&zip_path);

        // ── Extracted directory mode ─────────────────────────────────────────
        if zip_path_p.is_dir() {
            let mut names: Vec<String> = Vec::new();
            for entry in std::fs::read_dir(zip_path_p)
                .map_err(|e| format!("Cannot read directory: {e}"))?
            {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().to_string();
                let lower = name.to_lowercase();
                if lower.ends_with(".zip") || lower.ends_with(".unitypackage") {
                    names.push(name);
                }
            }
            names.sort();
            return Ok(names);
        }

        // ── Container zip mode ───────────────────────────────────────────────
        let file = open_file_shared(&zip_path)?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;

        let mut names: Vec<String> = Vec::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i)
                .map_err(|e| format!("Zip read error: {e}"))?;
            let name = entry.name().to_string();
            // Only top-level entries (no path separator) that are zip/unitypackage
            if !name.contains('/') && !name.contains('\\') {
                let lower = name.to_lowercase();
                if lower.ends_with(".zip") || lower.ends_with(".unitypackage") {
                    names.push(name);
                }
            }
        }
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Extracts a named entry from the container zip to the OS temp directory.
/// Returns the path to the extracted file.
#[tauri::command]
pub async fn extract_sub_zip_to_temp(
    zip_path: String,
    sub_zip_name: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let zip_path_p = std::path::Path::new(&zip_path);

        // ── Extracted (directory) mode ──────────────────────────────────────
        // When the inventory item was decompressed with decompress_item, local_path
        // becomes a directory containing the individual sub-zips directly on disk.
        // No container zip to open — just return the direct file path.
        if zip_path_p.is_dir() {
            let direct = zip_path_p.join(&sub_zip_name);
            if direct.is_file() {
                return Ok(direct.to_string_lossy().to_string());
            }
            return Err(format!(
                "Sub-zip '{}' not found in extracted directory '{}'",
                sub_zip_name, zip_path
            ));
        }

        // ── Container zip mode ───────────────────────────────────────────────
        let file = open_file_shared(&zip_path)?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;

        let mut entry = archive
            .by_name(&sub_zip_name)
            .map_err(|_| format!("Entry '{}' not found in zip", sub_zip_name))?;

        let temp_dir = std::env::temp_dir().join("vrc_studio_variants");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Cannot create temp dir: {e}"))?;

        let out_path = temp_dir.join(&sub_zip_name);
        let mut out_file = std::fs::File::create(&out_path)
            .map_err(|e| format!("Cannot write temp file: {e}"))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("Extraction failed: {e}"))?;

        Ok(out_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns all variants for a given inventory item.
#[tauri::command]
pub async fn get_item_variants(
    pool: State<'_, DbPool>,
    item_id: String,
) -> Result<Vec<ItemVariant>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, item_id, label, is_materials, sub_zip_name, sort_order, custom_image_path
         FROM inventory_item_variants
         WHERE item_id = ?1
         ORDER BY sort_order ASC, label ASC",
    )?;

    // We also need the parent item's zip_path to calculate size
    let zip_path: Option<String> = conn
        .query_row(
            "SELECT local_path FROM inventory_items WHERE id = ?1",
            params![item_id],
            |row| row.get(0),
        )
        .ok();

    let variants: Vec<ItemVariant> = stmt
        .query_map(params![item_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .map(|(id, item_id, label, is_materials_int, sub_zip_name, sort_order, custom_image_path)| {
            let is_materials = is_materials_int != 0;
            // Derive size from zip entry
            let (size_bytes, is_compressed) =
                zip_path.as_deref().and_then(|zp| {
                    let f = open_file_shared(zp).ok()?;
                    let mut arch = ZipArchive::new(f).ok()?;
                    let entry = arch.by_name(&sub_zip_name).ok()?;
                    Some((Some(entry.size()), entry.compression() != zip::CompressionMethod::Stored))
                })
                .unwrap_or((None, false));

            ItemVariant {
                id,
                item_id,
                label,
                is_materials,
                sub_zip_name,
                sort_order,
                size_bytes,
                is_compressed,
                custom_image_path,
            }
        })
        .collect();

    Ok(variants)
}

/// Imports a container zip as a multi-avatar item.
/// Creates inventory_item with is_multi_avatar=1 and all variant rows atomically.
#[tauri::command]
pub async fn import_multi_avatar_package(
    pool: State<'_, DbPool>,
    args: ImportMultiAvatarArgs,
) -> Result<String, AppError> {
    let conn = pool.get()?;
    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Compute file size
    let size_bytes: Option<i64> = std::fs::metadata(&args.zip_path)
        .ok()
        .map(|m| m.len() as i64);

    conn.execute(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date,
          size_bytes, is_compressed, display_name, is_multi_avatar)
         VALUES (?1,?2,?3,'local',?4,?5,?6,?7,?8,0,?2,1)",
        params![
            item_id,
            args.name,
            args.author,
            args.booth_id,
            args.zip_path,
            args.thumbnail_url,
            now,
            size_bytes,
        ],
    )?;

    // Assign to folder if provided (stored in junction table, not inventory_items)
    if let Some(ref fid) = args.folder_id {
        conn.execute(
            "INSERT OR IGNORE INTO inventory_folder_items (folder_id, item_id) VALUES (?1, ?2)",
            params![fid, item_id],
        ).ok();
    }

    for (i, variant) in args.variants.iter().enumerate() {
        let vid = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO inventory_item_variants
             (id, item_id, label, is_materials, sub_zip_name, sort_order)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                vid,
                item_id,
                variant.label,
                variant.is_materials,
                variant.sub_zip_name,
                i as i64,
            ],
        )?;
    }

    // Store product images as JSON in the inventory_items column (same as set_item_product_images)
    if !args.product_images.is_empty() {
        let json = serde_json::to_string(&args.product_images)
            .unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "UPDATE inventory_items SET product_images = ?1 WHERE id = ?2",
            params![json, item_id],
        ).ok();
    }

    Ok(item_id)
}

/// Rewrites the container zip at `zip_path` replacing the bytes of `entry_name`
/// with `new_bytes`. If `new_bytes` is None, the entry is deleted entirely.
fn rewrite_zip_entry(
    zip_path: &str,
    entry_name: &str,
    new_bytes: Option<Vec<u8>>,
    compression: zip::CompressionMethod,
) -> Result<(), String> {
    use std::io::Write;

    let original = std::fs::read(zip_path)
        .map_err(|e| format!("Cannot read zip: {e}"))?;
    let mut old_archive = ZipArchive::new(std::io::Cursor::new(&original))
        .map_err(|e| format!("Invalid zip: {e}"))?;

    // Write new zip into a memory buffer (avoids temp-file + rename on Windows)
    let out_cursor = std::io::Cursor::new(Vec::with_capacity(original.len()));
    let mut writer = zip::ZipWriter::new(out_cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for i in 0..old_archive.len() {
        let mut entry = old_archive
            .by_index(i)
            .map_err(|e| format!("Zip read error: {e}"))?;
        let name = entry.name().to_string();

        if name == entry_name {
            if let Some(ref bytes) = new_bytes {
                // Replace with new bytes using specified compression
                let opts = zip::write::SimpleFileOptions::default()
                    .compression_method(compression);
                writer
                    .start_file(&name, opts)
                    .map_err(|e| format!("Zip write error: {e}"))?;
                writer
                    .write_all(bytes)
                    .map_err(|e| format!("Zip write error: {e}"))?;
            }
            // If new_bytes is None, skip entry (delete it)
        } else {
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("Zip read error: {e}"))?;
            writer
                .start_file(&name, options)
                .map_err(|e| format!("Zip write error: {e}"))?;
            writer
                .write_all(&buf)
                .map_err(|e| format!("Zip write error: {e}"))?;
        }
    }

    // Finalize and get the buffer back
    let out_cursor = writer.finish()
        .map_err(|e| format!("Zip finish error: {e}"))?;

    // Write result directly to the original path (no rename needed)
    std::fs::write(zip_path, out_cursor.into_inner())
        .map_err(|e| format!("Cannot replace zip: {e}"))?;

    Ok(())
}

/// Deletes a variant: removes DB row + removes entry from container zip.
#[tauri::command]
pub async fn delete_variant(
    pool: State<'_, DbPool>,
    item_id: String,
    variant_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    let (sub_zip_name, zip_path): (String, String) = conn.query_row(
        "SELECT v.sub_zip_name, i.local_path
         FROM inventory_item_variants v
         JOIN inventory_items i ON i.id = v.item_id
         WHERE v.id = ?1 AND v.item_id = ?2",
        params![variant_id, item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tokio::task::spawn_blocking(move || {
        rewrite_zip_entry(&zip_path, &sub_zip_name, None, zip::CompressionMethod::Deflated)
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(|e| AppError::External(e))?;

    conn.execute(
        "DELETE FROM inventory_item_variants WHERE id = ?1",
        params![variant_id],
    )?;

    Ok(())
}

/// Compresses a variant sub-zip in place using Deflated compression.
#[tauri::command]
pub async fn compress_variant(
    pool: State<'_, DbPool>,
    item_id: String,
    variant_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let (sub_zip_name, zip_path): (String, String) = conn.query_row(
        "SELECT v.sub_zip_name, i.local_path
         FROM inventory_item_variants v
         JOIN inventory_items i ON i.id = v.item_id
         WHERE v.id = ?1 AND v.item_id = ?2",
        params![variant_id, item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = open_file_shared(&zip_path)?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;
        let mut entry = archive
            .by_name(&sub_zip_name)
            .map_err(|_| format!("Entry not found: {sub_zip_name}"))?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("Read error: {e}"))?;
        drop(entry);
        drop(archive);

        rewrite_zip_entry(&zip_path, &sub_zip_name, Some(bytes), zip::CompressionMethod::Deflated)
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(|e| AppError::External(e))?;

    Ok(())
}

/// Decompresses a variant sub-zip in place (stores uncompressed).
#[tauri::command]
pub async fn decompress_variant(
    pool: State<'_, DbPool>,
    item_id: String,
    variant_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let (sub_zip_name, zip_path): (String, String) = conn.query_row(
        "SELECT v.sub_zip_name, i.local_path
         FROM inventory_item_variants v
         JOIN inventory_items i ON i.id = v.item_id
         WHERE v.id = ?1 AND v.item_id = ?2",
        params![variant_id, item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = open_file_shared(&zip_path)?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;
        let mut entry = archive
            .by_name(&sub_zip_name)
            .map_err(|_| format!("Entry not found: {sub_zip_name}"))?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("Read error: {e}"))?;
        drop(entry);
        drop(archive);

        rewrite_zip_entry(&zip_path, &sub_zip_name, Some(bytes), zip::CompressionMethod::Stored)
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(|e| AppError::External(e))?;

    Ok(())
}

/// Copies the SQLite DB file and all inventory zip files to a timestamped backup folder.
/// Returns the backup directory path.
#[tauri::command]
pub async fn create_migration_backup(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_dir = data_dir.join("backups").join(&timestamp);
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Cannot create backup dir: {e}"))?;

    // Copy DB file
    let db_path = data_dir.join("vrc-studio.db");
    if db_path.exists() {
        std::fs::copy(&db_path, backup_dir.join("vrc-studio.db"))
            .map_err(|e| format!("Cannot backup DB: {e}"))?;
    }

    // Copy all .zip files in the inventory directory
    let inventory_dir = data_dir.join("inventory");
    if inventory_dir.exists() {
        let zip_backup = backup_dir.join("inventory");
        std::fs::create_dir_all(&zip_backup)
            .map_err(|e| format!("Cannot create inventory backup dir: {e}"))?;
        for entry in std::fs::read_dir(&inventory_dir)
            .map_err(|e| format!("Cannot read inventory dir: {e}"))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("zip") {
                let filename = path.file_name().unwrap().to_string_lossy().to_string();
                std::fs::copy(&path, zip_backup.join(&filename))
                    .map_err(|e| format!("Cannot backup {filename}: {e}"))?;
            }
        }
    }

    Ok(backup_dir.to_string_lossy().to_string())
}

/// Creates a new zip container whose top-level entries are the files at `source_paths`.
/// Each file is added using its filename only (no directory structure).
#[tauri::command]
pub async fn create_container_zip(
    source_paths: Vec<String>,
    output_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;

        let out_file = std::fs::File::create(&output_path)
            .map_err(|e| format!("Cannot create output zip: {e}"))?;
        let mut writer = zip::ZipWriter::new(out_file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for src in &source_paths {
            let filename = Path::new(src)
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| format!("Invalid path: {src}"))?;

            let bytes = std::fs::read(src)
                .map_err(|e| format!("Cannot read {src}: {e}"))?;

            writer
                .start_file(filename, options)
                .map_err(|e| format!("Zip write error: {e}"))?;
            writer
                .write_all(&bytes)
                .map_err(|e| format!("Zip write error: {e}"))?;
        }

        writer.finish().map_err(|e| format!("Zip finish error: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sets a custom image path for a specific variant.
#[tauri::command]
pub async fn set_variant_custom_image(
    pool: State<'_, DbPool>,
    variant_id: String,
    image_path: Option<String>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "UPDATE inventory_item_variants SET custom_image_path = ?1 WHERE id = ?2",
        params![image_path, variant_id],
    )?;
    Ok(())
}
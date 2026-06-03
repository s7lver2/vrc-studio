// src-tauri/src/commands/multi_avatar.rs
use crate::db::DbPool;
use crate::error::AppError;
use crate::models::ItemVariant;
use rusqlite::params;
use tauri::State;
use zip::ZipArchive;

/// Lists top-level .zip / .unitypackage entries inside a container zip.
#[tauri::command]
pub async fn list_zip_contents(zip_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Cannot open zip: {e}"))?;
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
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Cannot open zip: {e}"))?;
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
        "SELECT id, item_id, label, is_materials, sub_zip_name, sort_order
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
            ))
        })?
        .filter_map(|r| r.ok())
        .map(|(id, item_id, label, is_materials_int, sub_zip_name, sort_order)| {
            let is_materials = is_materials_int != 0;
            // Derive size from zip entry
            let (size_bytes, is_compressed) =
                zip_path.as_deref().and_then(|zp| {
                    let f = std::fs::File::open(zp).ok()?;
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
            }
        })
        .collect();

    Ok(variants)
}

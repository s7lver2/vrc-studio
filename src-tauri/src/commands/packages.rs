use rusqlite::{params, OptionalExtension};
use crate::db::DbPool;
use tauri::{AppHandle, Manager, State};

use crate::db::packages_repo;
use crate::error::AppError;
use crate::models::{CreatePackagePayload, CustomPackage};
use crate::services::{package_builder, vpm};

// ── helpers ───────────────────────────────────────────────────────────────────

async fn regenerate_local_index(pool: &DbPool, data_dir: &std::path::Path) -> Result<(), AppError> {
    let all_pkgs = packages_repo::list_packages(pool)?;
    let index_path = data_dir.join("local-index.json");
    let entries: Vec<vpm::VpmPackageEntry> = all_pkgs
        .into_iter()
        .filter_map(|p| p.zip_path.clone().map(|zip_path| vpm::VpmPackageEntry {
            name: p.name,
            display_name: p.display_name,
            version: p.version,
            description: p.description.unwrap_or_default(),
            zip_path,
        }))
        .collect();
    let index_json = vpm::build_local_index(&entries, index_path.to_str().unwrap_or(""));
    std::fs::write(&index_path, index_json)?;
    Ok(())
}

fn get_asset_paths(pool: &DbPool, asset_ids: &[String]) -> Result<Vec<String>, AppError> {
    let conn = pool.get()?;
    let mut paths = Vec::new();
    for id in asset_ids {
        let path: String = conn
            .query_row("SELECT local_path FROM inventory_items WHERE id = ?1", params![id], |row| row.get(0))
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("InventoryItem {id}")))?;
        paths.push(path);
    }
    Ok(paths)
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_packages(pool: State<'_, DbPool>) -> Result<Vec<CustomPackage>, AppError> {
    packages_repo::list_packages(&pool)
}

#[tauri::command]
pub async fn create_package(
    pool: State<'_, DbPool>,
    payload: CreatePackagePayload,
) -> Result<CustomPackage, AppError> {
    let id = packages_repo::insert_package(&pool, &payload.name, &payload.display_name, &payload.version, &payload.description)?;
    packages_repo::set_package_assets(&pool, &id, &payload.asset_ids)?;
    packages_repo::get_package(&pool, &id)   // ← ya devuelve Result<CustomPackage>
}

#[tauri::command]
pub async fn update_package(
    pool: State<'_, DbPool>,
    id: String,
    payload: CreatePackagePayload,
) -> Result<CustomPackage, AppError> {
    packages_repo::update_package(&pool, &id, &payload.display_name, &payload.version, &payload.description).await?;
    packages_repo::set_package_assets(&pool, &id, &payload.asset_ids)?;
    packages_repo::get_package(&pool, &id)
}

#[tauri::command]
pub async fn build_package(
    pool: State<'_, DbPool>,
    app: AppHandle,
    id: String,
) -> Result<CustomPackage, AppError> {
    let pkg = packages_repo::get_package(&pool, &id)?;
    let data_dir = app.path().app_data_dir().map_err(|e| AppError::External(e.to_string()))?;
    let pkgs_dir = data_dir.join("packages").join(&pkg.name);
    std::fs::create_dir_all(&pkgs_dir)?;

    let zip_path = pkgs_dir.join(format!("{}-{}.zip", pkg.name, pkg.version));
    let json_path = pkgs_dir.join("package.json");
    let asset_paths = get_asset_paths(&pool, &pkg.asset_ids)?;

    let package_json = vpm::generate_package_json(
        &pkg.name,
        &pkg.display_name,
        &pkg.version,
        pkg.description.as_deref().unwrap_or(""),
        zip_path.to_str().unwrap_or(""),
    );
    std::fs::write(&json_path, &package_json)?;
    package_builder::build_zip(&package_json, &asset_paths, zip_path.to_str().unwrap_or(""))
        .map_err(|e| AppError::External(e.to_string()))?;

    packages_repo::update_package_paths(&pool, &id, json_path.to_str().unwrap_or(""), Some(zip_path.to_str().unwrap_or("")))?;
    regenerate_local_index(&pool, &data_dir).await?;
    packages_repo::get_package(&pool, &id)
}

#[tauri::command]
pub async fn delete_package(
    pool: State<'_, DbPool>,
    app: AppHandle,
    id: String,
) -> Result<(), AppError> {
    packages_repo::delete_package(&pool, &id)?;
    let data_dir = app.path().app_data_dir().map_err(|e| AppError::External(e.to_string()))?;
    regenerate_local_index(&pool, &data_dir).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_vpm_package_files(url: String) -> Result<Vec<String>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::External(e.to_string()))?;

    let head = client.head(&url).send().await
        .map_err(|e| AppError::External(format!("HEAD failed: {e}")))?;

    let content_length = head
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| AppError::External("No content-length in response".into()))?;

    let fetch_size: u64 = 65_536.min(content_length);
    let range_start = content_length.saturating_sub(fetch_size);
    let range_header = format!("bytes={range_start}-{}", content_length - 1);

    let tail = client
        .get(&url)
        .header("Range", &range_header)
        .send()
        .await
        .map_err(|e| AppError::External(format!("Range GET failed: {e}")))?;

    if !tail.status().is_success() && tail.status().as_u16() != 206 {
        return Err(AppError::External(format!(
            "Server returned {} for range request",
            tail.status()
        )));
    }

    let bytes = tail.bytes().await
        .map_err(|e| AppError::External(format!("Read body failed: {e}")))?;

    let files = parse_zip_central_directory(&bytes, range_start);
    Ok(files)
}

fn parse_zip_central_directory(data: &[u8], _offset: u64) -> Vec<String> {
    const CENTRAL_DIR_SIG: &[u8] = &[0x50, 0x4b, 0x01, 0x02];
    let mut files = Vec::new();
    let mut i = 0;
    while i + 46 <= data.len() {
        if &data[i..i + 4] == CENTRAL_DIR_SIG {
            let name_len = u16::from_le_bytes([data[i + 28], data[i + 29]]) as usize;
            let extra_len = u16::from_le_bytes([data[i + 30], data[i + 31]]) as usize;
            let comment_len = u16::from_le_bytes([data[i + 32], data[i + 33]]) as usize;
            let name_start = i + 46;
            let name_end = name_start + name_len;
            if name_end <= data.len() {
                if let Ok(name) = std::str::from_utf8(&data[name_start..name_end]) {
                    files.push(name.to_string());
                }
            }
            i += 46 + name_len + extra_len + comment_len;
        } else {
            i += 1;
        }
    }
    files
}
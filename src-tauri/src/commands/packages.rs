use sqlx::SqlitePool;
use tauri::{AppHandle, Manager, State};

use crate::db::packages_repo;
use crate::error::AppError;
use crate::models::{CreatePackagePayload, CustomPackage};
use crate::services::{package_builder, vpm};

// ── helpers ───────────────────────────────────────────────────────────────────

/// Regenera el índice VPM local (`local-index.json`) en el directorio de datos de la app.
async fn regenerate_local_index(pool: &SqlitePool, data_dir: &std::path::Path) -> Result<(), AppError> {
    let all_pkgs = packages_repo::list_packages(pool).await?;
    let index_path = data_dir.join("local-index.json");

    let entries: Vec<vpm::VpmPackageEntry> = all_pkgs
        .into_iter()
        .filter_map(|p| {
            // Solo incluir en el índice paquetes que tienen un ZIP generado
            p.zip_path.map(|zip_path| vpm::VpmPackageEntry {
                name: p.name,
                display_name: p.display_name,
                version: p.version,
                description: p.description.unwrap_or_default(),
                zip_path,
            })
        })
        .collect();

    let index_json = vpm::build_local_index(&entries, index_path.to_str().unwrap_or(""));
    std::fs::write(&index_path, index_json)?;
    Ok(())
}

/// Obtiene las rutas en disco de los inventory_items por sus IDs.
async fn get_asset_paths(pool: &SqlitePool, asset_ids: &[String]) -> Result<Vec<String>, AppError> {
    use sqlx::Row;
    let mut paths = Vec::new();
    for id in asset_ids {
        let row = sqlx::query("SELECT local_path FROM inventory_items WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("InventoryItem {id}")))?;
        paths.push(row.get::<String, _>("local_path"));
    }
    Ok(paths)
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Lista todos los paquetes custom.
#[tauri::command]
pub async fn list_packages(pool: State<'_, SqlitePool>) -> Result<Vec<CustomPackage>, AppError> {
    packages_repo::list_packages(&pool).await
}

/// Crea un paquete nuevo y devuelve el registro insertado.
#[tauri::command]
pub async fn create_package(
    pool: State<'_, SqlitePool>,
    payload: CreatePackagePayload,
) -> Result<CustomPackage, AppError> {
    let id = packages_repo::insert_package(
        &pool,
        &payload.name,
        &payload.display_name,
        &payload.version,
        &payload.description,
    )
    .await?;

    packages_repo::set_package_assets(&pool, &id, &payload.asset_ids).await?;

    packages_repo::get_package(&pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Package {id} after insert")))
}

/// Actualiza un paquete existente y devuelve el registro actualizado.
#[tauri::command]
pub async fn update_package(
    pool: State<'_, SqlitePool>,
    id: String,
    payload: CreatePackagePayload,
) -> Result<CustomPackage, AppError> {
    packages_repo::update_package(
        &pool,
        &id,
        &payload.display_name,
        &payload.version,
        &payload.description,
    )
    .await?;

    packages_repo::set_package_assets(&pool, &id, &payload.asset_ids).await?;

    packages_repo::get_package(&pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Package {id} after update")))
}

/// Elimina un paquete y regenera el índice local.
#[tauri::command]
pub async fn delete_package(
    pool: State<'_, SqlitePool>,
    app: AppHandle,
    id: String,
) -> Result<(), AppError> {
    packages_repo::delete_package(&pool, &id).await?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    regenerate_local_index(&pool, &data_dir).await?;

    Ok(())
}

/// Genera el package.json y el ZIP del paquete, persiste las rutas en DB
/// y regenera el índice VPM local.
#[tauri::command]
pub async fn build_package(
    pool: State<'_, SqlitePool>,
    app: AppHandle,
    id: String,
) -> Result<CustomPackage, AppError> {
    let pkg = packages_repo::get_package(&pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Package {id}")))?;

    // Directorio de salida: AppData/vrc-studio/packages/<pkg.name>/
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::External(e.to_string()))?;
    let pkgs_dir = data_dir.join("packages").join(&pkg.name);
    std::fs::create_dir_all(&pkgs_dir)?;

    let zip_path = pkgs_dir.join(format!("{}-{}.zip", pkg.name, pkg.version));
    let json_path = pkgs_dir.join("package.json");

    // Obtener rutas en disco de los assets seleccionados
    let asset_paths = get_asset_paths(&pool, &pkg.asset_ids).await?;

    // Generar package.json
    let package_json = vpm::generate_package_json(
        &pkg.name,
        &pkg.display_name,
        &pkg.version,
        pkg.description.as_deref().unwrap_or(""),
        zip_path.to_str().unwrap_or(""),
    );

    // Escribir package.json al disco
    std::fs::write(&json_path, &package_json)?;

    // Construir el ZIP
    package_builder::build_zip(
        &package_json,
        &asset_paths,
        zip_path.to_str().unwrap_or(""),
    )
    .map_err(|e| AppError::External(e.to_string()))?;

    // Persistir rutas en DB
    packages_repo::update_package_paths(
        &pool,
        &id,
        json_path.to_str().unwrap_or(""),
        zip_path.to_str().unwrap_or(""),
    )
    .await?;

    // Regenerar el índice local
    regenerate_local_index(&pool, &data_dir).await?;

    packages_repo::get_package(&pool, &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Package {id} after build")))
}
/// Ajustes de almacenamiento: ruta de assets, estadísticas de disco, limpieza de caché.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri::Manager;

const SETTINGS_FILE: &str = "app-settings.json";

// ── Modelo de ajustes ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    /// Si es Some, los assets se guardan aquí en lugar del directorio de caché por defecto.
    pub custom_assets_dir: Option<String>,
}

// ── Helpers internos ──────────────────────────────────────────────────────────

fn settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir unavailable")
        .join(SETTINGS_FILE)
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(app), json).map_err(|e| e.to_string())
}

/// Directorio raíz donde se almacenan los assets del inventario.
pub fn get_assets_root(app: &AppHandle) -> PathBuf {
    match load_settings(app).custom_assets_dir {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => app
            .path()
            .app_cache_dir()
            .expect("app_cache_dir unavailable")
            .join("downloads"),
    }
}

/// Tamaño recursivo de un directorio (en bytes). Silencia errores de permisos.
fn dir_size(path: &Path) -> u64 {
    if !path.is_dir() {
        return std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    let Ok(rd) = std::fs::read_dir(path) else { return 0; };
    rd.flatten()
        .map(|e| {
            let p = e.path();
            if p.is_dir() { dir_size(&p) } else { std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0) }
        })
        .sum()
}

/// Copia un directorio completo de src a dst (cross-drive safe).
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)?.flatten() {
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Mueve un directorio: intenta rename, cae en copy+delete si están en unidades distintas.
fn move_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    match std::fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_all(src, dst)?;
            std::fs::remove_dir_all(src)
        }
    }
}

// ── Comandos ──────────────────────────────────────────────────────────────────

#[tauri::command]
/// Grants Tauri FS scope access to the current assets root directory.
/// Must be called at app startup and whenever custom_assets_dir changes,
/// so files under user-configured paths can be read by the frontend.
pub fn grant_assets_scope(app: &AppHandle) {
    use tauri_plugin_fs::FsExt;
    // Ya existente: assets root (donde viven los ítems)
    let root = get_assets_root(app);
    if let Err(e) = app.fs_scope().allow_directory(&root, true) {
        eprintln!("[scope] Failed to allow assets dir {:?}: {}", root, e);
    }
    // NUEVO: covers dir (imágenes custom guardadas por la app)
    if let Ok(data_dir) = app.path().app_data_dir() {
        let covers_dir = data_dir.join("covers");
        if let Err(e) = app.fs_scope().allow_directory(&covers_dir, true) {
            eprintln!("[scope] Failed to allow covers dir {:?}: {}", covers_dir, e);
        }
        // Permitir también app_data_dir completo por si hay otros assets
        if let Err(e) = app.fs_scope().allow_directory(&data_dir, true) {
            eprintln!("[scope] Failed to allow app_data_dir {:?}: {}", data_dir, e);
        }
    }
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> AppSettings {
    load_settings(&app)
}

#[tauri::command]
pub fn set_app_settings(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    save_settings(&app, &settings)?;
    // Grant FS scope access to the (potentially new) assets directory so that
    // custom paths outside AppLocalData/Home are readable by the frontend.
    grant_assets_scope(&app);
    Ok(())
}

// ── Estadísticas de almacenamiento ────────────────────────────────────────────

#[derive(Serialize)]
pub struct StorageStats {
    /// Bytes totales del directorio de assets (incluyendo todos los items del inventario).
    pub assets_bytes: u64,
    /// Bytes de thumbnails en caché.
    pub thumbnails_bytes: u64,
    /// Bytes del archivo de base de datos.
    pub db_bytes: u64,
    /// Suma total.
    pub total_bytes: u64,
    /// Bytes de directorios de assets huérfanos (no referenciados por ningún item).
    pub orphaned_bytes: u64,
    /// Número de directorios huérfanos.
    pub orphaned_count: u32,
    /// Ruta raíz actual de assets.
    pub assets_root: String,
}

/// Devuelve el conjunto de prefijos de ruta referenciados por items del inventario.
async fn referenced_prefixes(pool: &SqlitePool) -> Result<Vec<String>, String> {
    let rows = sqlx::query("SELECT local_path FROM inventory_items")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| sqlx::Row::get::<String, _>(r, "local_path"))
        .collect())
}

/// Devuelve true si ninguna de las rutas referenciadas empieza con `dir_str`.
fn is_orphaned(dir_str: &str, referenced: &[String]) -> bool {
    !referenced.iter().any(|p| {
        // Comparar con y sin trailing separator para evitar falsos positivos
        p.starts_with(dir_str)
    })
}

/// Itera los directorios directos de `root` más los de `root/local/` (imports locales).
fn iter_item_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(rd) = std::fs::read_dir(root) else { return dirs; };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() { continue; }
        if p.file_name().and_then(|n| n.to_str()) == Some("local") {
            // Subdirectorio especial: contiene <uuid>/ por cada import local
            let Ok(inner) = std::fs::read_dir(&p) else { continue; };
            for sub in inner.flatten() {
                let sp = sub.path();
                if sp.is_dir() { dirs.push(sp); }
            }
        } else {
            dirs.push(p);
        }
    }
    dirs
}

#[tauri::command]
pub async fn get_storage_stats(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<StorageStats, String> {
    let assets_root = get_assets_root(&app);
    let referenced = referenced_prefixes(&pool).await?;

    let mut orphaned_bytes = 0u64;
    let mut orphaned_count = 0u32;

    for dir in iter_item_dirs(&assets_root) {
        let dir_str = dir.to_string_lossy().to_string();
        if is_orphaned(&dir_str, &referenced) {
            orphaned_bytes += dir_size(&dir);
            orphaned_count += 1;
        }
    }

    let assets_bytes = dir_size(&assets_root);
    let thumbnails_bytes = dir_size(
        &app.path().app_cache_dir().expect("cache").join("thumbnails"),
    );
    let db_bytes = std::fs::metadata(
        app.path().app_data_dir().expect("data").join("vrc-studio.db"),
    )
    .map(|m| m.len())
    .unwrap_or(0);

    Ok(StorageStats {
        assets_bytes,
        thumbnails_bytes,
        db_bytes,
        total_bytes: assets_bytes + thumbnails_bytes + db_bytes,
        orphaned_bytes,
        orphaned_count,
        assets_root: assets_root.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn clear_orphaned_cache(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<u64, String> {
    let assets_root = get_assets_root(&app);
    let referenced = referenced_prefixes(&pool).await?;
    let mut freed = 0u64;

    for dir in iter_item_dirs(&assets_root) {
        let dir_str = dir.to_string_lossy().to_string();
        if is_orphaned(&dir_str, &referenced) {
            freed += dir_size(&dir);
            std::fs::remove_dir_all(&dir).map_err(|e| format!("Error al borrar {}: {}", dir_str, e))?;
        }
    }

    Ok(freed)
}

// ── Migración de assets ───────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct MigrationResult {
    pub moved: u32,
    pub errors: Vec<String>,
    pub new_assets_root: String,
}

#[tauri::command]
pub async fn migrate_assets(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    new_dir: String,
) -> Result<MigrationResult, String> {
    let old_root = get_assets_root(&app);
    let new_root = PathBuf::from(&new_dir);

    // Normalizar para comparación (sin trailing slash)
    let old_root_str = old_root.to_string_lossy().to_string();
    let new_root_str = new_root.to_string_lossy().to_string();

    if old_root_str.trim_end_matches(['/', '\\']) == new_root_str.trim_end_matches(['/', '\\']) {
        // Ya es la misma ruta; solo guardamos el ajuste
        let mut settings = load_settings(&app);
        settings.custom_assets_dir = Some(new_dir.clone());
        save_settings(&app, &settings)?;
        return Ok(MigrationResult { moved: 0, errors: vec![], new_assets_root: new_dir });
    }

    std::fs::create_dir_all(&new_root).map_err(|e| e.to_string())?;

    // Leer todos los items
    let rows = sqlx::query("SELECT id, local_path FROM inventory_items")
        .fetch_all(&*pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut errors = Vec::new();
    let mut moved_item_dirs: std::collections::HashMap<String, String> = Default::default(); // old → new

    for row in &rows {
        let id: String = sqlx::Row::get(row, "id");
        let local_path: String = sqlx::Row::get(row, "local_path");

        // Solo mover items cuya ruta está bajo old_root
        let Some(relative) = local_path.strip_prefix(&old_root_str) else { continue; };
        let relative = relative.trim_start_matches(['/', '\\']);

        // Primer componente = nombre del directorio de item (ej. "<source_id>" o "local")
        let first = relative.split(['/', '\\']).next().unwrap_or("");
        if first.is_empty() { continue; }

        // Distinguir entre import local (<old_root>/local/<uuid>/...) y shop (<old_root>/<id>/...)
        let (item_dir_name, is_local) = if first == "local" {
            // <old_root>/local/<uuid>/...
            let second = relative.split(['/', '\\']).nth(1).unwrap_or("");
            if second.is_empty() { continue; }
            (format!("local/{}", second), true)
        } else {
            (first.to_string(), false)
        };

        let old_item_dir = old_root.join(&item_dir_name);
        let new_item_dir = new_root.join(&item_dir_name);
        let old_item_str = old_item_dir.to_string_lossy().to_string();

        // Si ya se movió este item_dir, calcular la nueva ruta directamente
        if let Some(new_item_str) = moved_item_dirs.get(&old_item_str) {
            let new_local_path = local_path.replacen(&old_item_str, new_item_str, 1);
            if let Err(e) = sqlx::query("UPDATE inventory_items SET local_path = ? WHERE id = ?")
                .bind(&new_local_path)
                .bind(&id)
                .execute(&*pool)
                .await
            {
                errors.push(format!("DB update failed for {id}: {e}"));
            }
            continue;
        }

        // Crear el subdirectorio local/ en new_root si hace falta
        if is_local {
            let _ = std::fs::create_dir_all(new_root.join("local"));
        }

        // Mover el directorio del item
        if old_item_dir.is_dir() {
            match move_dir(&old_item_dir, &new_item_dir) {
                Ok(()) => {
                    let new_item_str = new_item_dir.to_string_lossy().to_string();
                    let new_local_path = local_path.replacen(&old_item_str, &new_item_str, 1);
                    if let Err(e) = sqlx::query("UPDATE inventory_items SET local_path = ? WHERE id = ?")
                        .bind(&new_local_path)
                        .bind(&id)
                        .execute(&*pool)
                        .await
                    {
                        errors.push(format!("DB update failed for {id}: {e}"));
                    }
                    moved_item_dirs.insert(old_item_str, new_item_str);
                }
                Err(e) => {
                    errors.push(format!("No se pudo mover {item_dir_name}: {e}"));
                }
            }
        }
    }

    // Guardar el nuevo ajuste
    let mut settings = load_settings(&app);
    settings.custom_assets_dir = Some(new_dir.clone());
    save_settings(&app, &settings)?;

    Ok(MigrationResult {
        moved: moved_item_dirs.len() as u32,
        errors,
        new_assets_root: new_dir,
    })
}
// ── Limpieza de thumbnails ────────────────────────────────────────────────────

/// Elimina todos los thumbnails en caché. Devuelve los bytes liberados.
#[tauri::command]
pub fn clear_thumbnails_cache(app: AppHandle) -> Result<u64, String> {
    let thumb_dir = app
        .path()
        .app_cache_dir()
        .expect("app_cache_dir unavailable")
        .join("thumbnails");

    if !thumb_dir.is_dir() {
        return Ok(0);
    }

    let freed = dir_size(&thumb_dir);
    std::fs::remove_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    Ok(freed)
}

/// Elimina thumbnails + directorios de assets huérfanos. Devuelve bytes liberados.
#[tauri::command]
pub async fn clear_all_cache(
    app: AppHandle,
    pool: State<'_, SqlitePool>,
) -> Result<u64, String> {
    let thumb_freed = clear_thumbnails_cache(app.clone())?;
    let orphan_freed = clear_orphaned_cache(app, pool).await?;
    Ok(thumb_freed + orphan_freed)
}
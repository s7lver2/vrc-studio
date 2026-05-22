/// Ajustes de almacenamiento: ruta de assets, estadísticas de disco, limpieza de caché.

use serde::{Deserialize, Serialize};
use rusqlite::params;
use crate::db::DbPool;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri::Manager;

const SETTINGS_FILE: &str = "app-settings.json";

// ── Modelo de ajustes ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    /// Si es Some, los assets se guardan aquí en lugar del directorio de caché por defecto.
    pub custom_assets_dir: Option<String>,
    #[serde(default)]
    pub unity_import_skip_dialog: bool,

    /// Si true, importa los paquetes de uno en uno y emite eventos de progreso al frontend.
    /// Si false, abre todos los paquetes al mismo tiempo.
    #[serde(default)]
    pub unity_import_sequential: bool,

    /// Segundos que se esperan a que Unity arranque antes de comenzar la importación.
    /// Por defecto 180 (3 minutos). Mínimo 30, máximo 600.
    #[serde(default = "default_unity_boot_wait_secs")]
    pub unity_boot_wait_secs: u32,

    /// Extra VPM repository URLs added by the user in Settings → Import.
    #[serde(default)]
    pub extra_vpm_sources: Vec<String>,

    /// Si true, activa la caché en memoria de URLs de imágenes del inventario.
    /// Reduce llamadas IPC repetidas a convertFileSrc y pre-carga thumbnails remotos.
    #[serde(default = "default_image_cache_enabled")]
    pub image_cache_enabled: bool,

    /// Número máximo de entradas que puede tener la caché de imágenes.
    /// Rango razonable: 50–1000. Por defecto 300.
    #[serde(default = "default_image_cache_max_count")]
    pub image_cache_max_count: u32,
}

fn default_image_cache_enabled() -> bool { true }
fn default_image_cache_max_count() -> u32 { 300 }

fn default_unity_boot_wait_secs() -> u32 { 180 }

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
pub fn grant_assets_scope(app: &AppHandle) {
    use tauri_plugin_fs::FsExt;
    let root = get_assets_root(app);
    if let Err(e) = app.fs_scope().allow_directory(&root, true) {
        eprintln!("[scope] Failed to allow assets dir {:?}: {}", root, e);
    }
    if let Ok(data_dir) = app.path().app_data_dir() {
        let covers_dir = data_dir.join("covers");
        if let Err(e) = app.fs_scope().allow_directory(&covers_dir, true) {
            eprintln!("[scope] Failed to allow covers dir {:?}: {}", covers_dir, e);
        }
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
    grant_assets_scope(&app);
    Ok(())
}

// ── Estadísticas de almacenamiento ────────────────────────────────────────────

#[derive(Serialize)]
pub struct StorageStats {
    pub assets_bytes: u64,
    pub thumbnails_bytes: u64,
    pub db_bytes: u64,
    pub total_bytes: u64,
    pub orphaned_bytes: u64,
    pub orphaned_count: u32,
    pub assets_root: String,
}

/// Devuelve el conjunto de prefijos de ruta referenciados por items del inventario.
fn referenced_prefixes(pool: &DbPool) -> Result<Vec<String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT local_path FROM inventory_items").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
    let paths: Vec<String> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    Ok(paths)
}

fn is_orphaned(dir_str: &str, referenced: &[String]) -> bool {
    !referenced.iter().any(|p| p.starts_with(dir_str))
}

fn iter_item_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(rd) = std::fs::read_dir(root) else { return dirs; };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() { continue; }
        if p.file_name().and_then(|n| n.to_str()) == Some("local") {
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
    pool: State<'_, DbPool>,
) -> Result<StorageStats, String> {
    let assets_root = get_assets_root(&app);
    let referenced = referenced_prefixes(&pool)?;  // <-- remove .await

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
    let thumbnails_bytes = dir_size(&app.path().app_cache_dir().expect("cache").join("thumbnails"));
    let db_bytes = std::fs::metadata(app.path().app_data_dir().expect("data").join("vrc-studio.db"))
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
    pool: State<'_, DbPool>,
) -> Result<u64, String> {
    let assets_root = get_assets_root(&app);
    let referenced = referenced_prefixes(&pool)?;  // <-- remove .await
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
    pool: State<'_, DbPool>,
    new_dir: String,
) -> Result<MigrationResult, String> {
    let old_root = get_assets_root(&app);
    let new_root = PathBuf::from(&new_dir);
    let old_root_str = old_root.to_string_lossy().to_string();
    let new_root_str = new_root.to_string_lossy().to_string();

    if old_root_str.trim_end_matches(['/', '\\']) == new_root_str.trim_end_matches(['/', '\\']) {
        let mut settings = load_settings(&app);
        settings.custom_assets_dir = Some(new_dir.clone());
        save_settings(&app, &settings)?;
        return Ok(MigrationResult { moved: 0, errors: vec![], new_assets_root: new_dir });
    }

    std::fs::create_dir_all(&new_root).map_err(|e| e.to_string())?;

    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, local_path FROM inventory_items").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;
    let items: Vec<(String, String)> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;

    let mut errors = Vec::new();
    let mut moved_item_dirs: std::collections::HashMap<String, String> = Default::default();

    for (id, local_path) in items {
        let Some(relative) = local_path.strip_prefix(&old_root_str) else { continue; };
        let relative = relative.trim_start_matches(['/', '\\']);
        let first = relative.split(['/', '\\']).next().unwrap_or("");
        if first.is_empty() { continue; }

        let (item_dir_name, is_local) = if first == "local" {
            let second = relative.split(['/', '\\']).nth(1).unwrap_or("");
            if second.is_empty() { continue; }
            (format!("local/{}", second), true)
        } else {
            (first.to_string(), false)
        };

        let old_item_dir = old_root.join(&item_dir_name);
        let new_item_dir = new_root.join(&item_dir_name);
        let old_item_str = old_item_dir.to_string_lossy().to_string();

        if let Some(new_item_str) = moved_item_dirs.get(&old_item_str) {
            let new_local_path = local_path.replacen(&old_item_str, new_item_str, 1);
            if let Err(e) = conn.execute(
                "UPDATE inventory_items SET local_path = ?1 WHERE id = ?2",
                params![new_local_path, id],
            ) {
                errors.push(format!("DB update failed for {id}: {e}"));
            }
            continue;
        }

        if is_local {
            let _ = std::fs::create_dir_all(new_root.join("local"));
        }

        if old_item_dir.is_dir() {
            match move_dir(&old_item_dir, &new_item_dir) {
                Ok(()) => {
                    let new_item_str = new_item_dir.to_string_lossy().to_string();
                    let new_local_path = local_path.replacen(&old_item_str, &new_item_str, 1);
                    if let Err(e) = conn.execute(
                        "UPDATE inventory_items SET local_path = ?1 WHERE id = ?2",
                        params![new_local_path, id],
                    ) {
                        errors.push(format!("DB update failed for {id}: {e}"));
                    }
                    moved_item_dirs.insert(old_item_str, new_item_str);
                }
                Err(e) => errors.push(format!("No se pudo mover {item_dir_name}: {e}")),
            }
        }
    }

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

#[tauri::command]
pub fn clear_thumbnails_cache(app: AppHandle) -> Result<u64, String> {
    let thumb_dir = app.path().app_cache_dir().expect("cache").join("thumbnails");
    if !thumb_dir.is_dir() { return Ok(0); }
    let freed = dir_size(&thumb_dir);
    std::fs::remove_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    Ok(freed)
}

#[tauri::command]
pub async fn clear_all_cache(app: AppHandle, pool: State<'_, DbPool>) -> Result<u64, String> {
    let thumb_freed = clear_thumbnails_cache(app.clone())?;
    let orphan_freed = clear_orphaned_cache(app, pool).await?;
    Ok(thumb_freed + orphan_freed)
}

// ── Escaneo de archivos reclaimables ──────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
pub struct ReclaimableFile {
    pub path: String,
    pub size_bytes: u64,
    pub category: String,
    pub description: String,
    pub source_name: String,
    pub can_compress: bool,
    pub is_directory: bool,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ScanReclaimableOptions {
    pub min_size_bytes: Option<u64>,
    pub include_unity_cache: Option<bool>,
    pub include_source_art: Option<bool>,
    pub include_blender: Option<bool>,
    pub include_logs: Option<bool>,
    pub include_videos: Option<bool>,
}

#[derive(Debug, serde::Serialize)]
pub struct DeleteReclaimableResult {
    pub deleted: usize,
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn scan_reclaimable_files(
    search_paths: Vec<String>,
    options: Option<ScanReclaimableOptions>,
    pool: State<'_, DbPool>,
) -> Result<Vec<ReclaimableFile>, crate::error::AppError> {
    let opts = options.unwrap_or(ScanReclaimableOptions {
        min_size_bytes:       Some(5 * 1024 * 1024),
        include_unity_cache:  Some(true),
        include_source_art:   Some(true),
        include_blender:      Some(true),
        include_logs:         Some(false),
        include_videos:       Some(true),
    });
    let min_size = opts.min_size_bytes.unwrap_or(5 * 1024 * 1024);

    let source_art_exts  = ["psd", "psb", "ai"];
    let blender_exts     = ["blend", "blend1"];
    let video_exts       = ["mp4", "mov", "avi", "mkv", "webm"];
    let log_exts         = ["log"];
    let unity_cache_dirs = ["Library", "Temp"];

    // Cargar nombres de proyectos desde DB
    let conn = pool.get()?;
    let mut stmt = conn.prepare("SELECT path, name FROM projects")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let project_names: std::collections::HashMap<String, String> = rows
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .collect();

    let mut results = Vec::new();
    for search_root in search_paths {
        let root = PathBuf::from(&search_root);
        if !root.exists() { continue; }
        let source_name = project_names.iter()
            .find(|(proj_path, _)| root.starts_with(proj_path.as_str()))
            .map(|(_, name)| name.clone())
            .unwrap_or_else(|| root.file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string());

        scan_dir_recursive(
            &root, &source_name, 0, 8,
            min_size,
            opts.include_unity_cache.unwrap_or(true),
            opts.include_source_art.unwrap_or(true),
            opts.include_blender.unwrap_or(true),
            opts.include_logs.unwrap_or(false),
            opts.include_videos.unwrap_or(true),
            &source_art_exts,
            &blender_exts,
            &video_exts,
            &log_exts,
            &unity_cache_dirs,
            &mut results,
        );
    }
    results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    Ok(results)
}

fn scan_dir_recursive(
    dir: &Path,
    source_name: &str,
    depth: u8,
    max_depth: u8,
    min_size: u64,
    unity_cache: bool,
    source_art: bool,
    blender: bool,
    logs: bool,
    videos: bool,
    source_art_exts:  &[&str],
    blender_exts:     &[&str],
    video_exts:       &[&str],
    log_exts:         &[&str],
    unity_cache_dirs: &[&str],
    out: &mut Vec<ReclaimableFile>,
) {
    if depth > max_depth { return; }
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if path.is_dir() {
            if unity_cache && unity_cache_dirs.contains(&name.as_str()) {
                let size = dir_size(&path);
                if size >= min_size {
                    out.push(ReclaimableFile {
                        path: path.to_string_lossy().to_string(),
                        size_bytes: size,
                        category: "unity_cache".to_string(),
                        description: format!("Unity {} folder (regenerable)", name),
                        source_name: source_name.to_string(),
                        can_compress: false,
                        is_directory: true,
                    });
                }
                continue;
            }
            scan_dir_recursive(
                &path, source_name, depth + 1, max_depth,
                min_size, unity_cache, source_art, blender, logs, videos,
                source_art_exts, blender_exts, video_exts, log_exts, unity_cache_dirs, out,
            );
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            if size < min_size { continue; }
            let (category, description, can_compress) = if source_art && source_art_exts.contains(&ext.as_str()) {
                ("source_art", format!("{} source file", ext.to_uppercase()), true)
            } else if blender && blender_exts.contains(&ext.as_str()) {
                ("blender", "Blender project file".to_string(), true)
            } else if videos && video_exts.contains(&ext.as_str()) {
                ("video", "Video reference file".to_string(), true)
            } else if logs && log_exts.contains(&ext.as_str()) {
                ("log", "Log file".to_string(), false)
            } else {
                continue;
            };
            out.push(ReclaimableFile {
                path: path.to_string_lossy().to_string(),
                size_bytes: size,
                category: category.to_string(),
                description,
                source_name: source_name.to_string(),
                can_compress,
                is_directory: false,
            });
        }
    }
}

fn dir_size(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .sum()
}

#[tauri::command]
pub async fn delete_reclaimable_files(paths: Vec<String>) -> Result<DeleteReclaimableResult, crate::error::AppError> {
    let mut deleted = 0;
    let mut freed_bytes = 0;
    let mut errors = Vec::new();
    for path_str in paths {
        let path = PathBuf::from(&path_str);
        if !path.exists() {
            errors.push(format!("Not found: {path_str}"));
            continue;
        }
        let size = if path.is_dir() { dir_size(&path) } else { std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) };
        let result = if path.is_dir() { std::fs::remove_dir_all(&path) } else { std::fs::remove_file(&path) };
        match result {
            Ok(_) => { deleted += 1; freed_bytes += size; }
            Err(e) => errors.push(format!("{path_str}: {e}")),
        }
    }
    Ok(DeleteReclaimableResult { deleted, freed_bytes, errors })
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn read_vcc_repos() -> Vec<String> {
    crate::services::vcc_reader::read_external_vpm_sources()
}

#[tauri::command]
pub fn debug_vcc_sources() -> Vec<(String, Vec<String>)> {
    crate::services::vcc_reader::diagnose()
}

#[tauri::command]
pub fn check_git_installed() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
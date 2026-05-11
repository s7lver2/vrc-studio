// src-tauri/src/commands/sandbox.rs
use crate::models::PrefabScene;
use crate::services::prefab_parser;
use std::path::PathBuf;

/// Parsea un archivo .prefab y devuelve la jerarquía, capas de animación
/// y metadatos del avatar VRC. Llamado desde el frontend al seleccionar un prefab.
#[tauri::command]
pub async fn parse_prefab(path: String) -> Result<PrefabScene, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("File not found: {path}"));
    }
    if p.extension().and_then(|e| e.to_str()) != Some("prefab") {
        return Err(format!("Not a .prefab file: {path}"));
    }
    prefab_parser::parse_prefab_file(&p).map_err(|e| e.to_string())
}
// src-tauri/src/commands/vrchat_photos.rs
//
// Scans the VRChat screenshots folder and returns a list of photo paths.
// All processing is local — no network access, no data sharing.

use std::path::PathBuf;

/// Returns the default VRChat screenshots folder for the current OS.
/// On Windows: %USERPROFILE%\Pictures\VRChat
/// On macOS/Linux: ~/Pictures/VRChat
#[tauri::command]
pub fn get_vrchat_photos_default_path() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let p = PathBuf::from(profile).join("Pictures").join("VRChat");
            return p.to_string_lossy().to_string();
        }
    }
    // Fallback: ~/Pictures/VRChat
    dirs_or_home()
        .join("Pictures")
        .join("VRChat")
        .to_string_lossy()
        .to_string()
}

fn dirs_or_home() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
    }
}

fn collect_photos(dir: &PathBuf, entries: &mut Vec<(String, String)>, limit: usize, depth: u32) {
    if depth > 3 {
        return;
    }
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.filter_map(|e| e.ok()) {
        if entries.len() >= limit * 4 {
            break;
        }
        let p = entry.path();
        if p.is_dir() {
            collect_photos(&p, entries, limit, depth + 1);
        } else if p.is_file() {
            if let Some(ext) = p.extension() {
                let ext = ext.to_ascii_lowercase();
                if ext == "png" || ext == "jpg" || ext == "jpeg" {
                    if let (Some(name), full) = (
                        p.file_name().map(|n| n.to_string_lossy().to_string()),
                        p.to_string_lossy().to_string(),
                    ) {
                        entries.push((name, full));
                    }
                }
            }
        }
    }
}

/// Scans a folder recursively for VRChat photo files (.png/.jpg) up to `max_count`.
/// Returns absolute paths sorted newest-first by filename
/// (VRChat names files with a timestamp so lexicographic ≈ chronological).
#[tauri::command]
pub async fn scan_vrchat_photos(
    folder_path: String,
    max_count: Option<usize>,
) -> Result<Vec<String>, String> {
    let limit = max_count.unwrap_or(500);
    let path = PathBuf::from(&folder_path);

    if !path.exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", folder_path));
    }

    tokio::task::spawn_blocking(move || {
        let mut entries: Vec<(String, String)> = Vec::new();
        collect_photos(&path, &mut entries, limit, 0);

        // Sort newest-first (filenames are timestamp-based)
        entries.sort_by(|a, b| b.0.cmp(&a.0));

        let paths: Vec<String> = entries
            .into_iter()
            .take(limit)
            .map(|(_, full)| full)
            .collect();

        Ok(paths)
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

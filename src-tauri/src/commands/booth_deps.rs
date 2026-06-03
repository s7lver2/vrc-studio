use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;

// ── Manifest types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothDepEntry {
    pub source: String,
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub version_hash: String, // SHA256 of the original downloaded .zip
    pub install_path: String, // relative to project root, e.g. "Assets/Booth/my-outfit"
    pub added_at: String,     // ISO 8601 date
    pub modified: bool,       // true when local files differ from hash snapshot
}

#[derive(Debug, Serialize, Deserialize)]
struct BoothDepsMetadata {
    vrcstudio_version: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BoothDepsManifest {
    metadata: BoothDepsMetadata,
    #[serde(default)]
    dependency: Vec<BoothDepEntry>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn manifest_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join("booth-deps.toml")
}

fn read_manifest(project_path: &str) -> Result<BoothDepsManifest, String> {
    let path = manifest_path(project_path);
    if !path.exists() {
        return Ok(BoothDepsManifest {
            metadata: BoothDepsMetadata {
                vrcstudio_version: "1.0".to_string(),
                created_at: chrono::Utc::now().format("%Y-%m-%d").to_string(),
            },
            dependency: vec![],
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    toml::from_str(&raw).map_err(|e| format!("Parse error in booth-deps.toml: {e}"))
}

fn write_manifest(project_path: &str, manifest: &BoothDepsManifest) -> Result<(), String> {
    let path = manifest_path(project_path);
    let raw = toml::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

const GITIGNORE_MARKER: &str = "# VRC Studio - Booth Dependency";

fn booth_deps_update_gitignore_impl(
    project_path: &str,
    install_path: &str,
    add: bool,
) -> Result<(), String> {
    let gitignore = Path::new(project_path).join(".gitignore");
    let existing = if gitignore.exists() {
        fs::read_to_string(&gitignore).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let marker_line = format!("{GITIGNORE_MARKER}: {install_path}");
    let ignore_line = format!("{install_path}/");

    // Remove any existing block for this install_path
    let mut lines: Vec<&str> = existing.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        if lines[i] == marker_line {
            lines.remove(i);
            if i < lines.len() && lines[i] == ignore_line {
                lines.remove(i);
            }
        } else {
            i += 1;
        }
    }

    let mut result = lines.join("\n");
    if !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }

    if add {
        result.push_str(&format!("{marker_line}\n{ignore_line}\n"));
    }

    fs::write(&gitignore, result).map_err(|e| e.to_string())
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Returns all dependency entries from booth-deps.toml for a given project path.
/// Returns an empty list if the file does not exist.
#[tauri::command]
pub fn booth_deps_read(project_path: String) -> Result<Vec<BoothDepEntry>, String> {
    let manifest = read_manifest(&project_path)?;
    Ok(manifest.dependency)
}

/// Callable from other modules (e.g. shop.rs) without going through Tauri command routing.
pub fn booth_deps_add_impl(
    project_path: &str,
    source_id: &str,
    name: &str,
    author: &str,
    zip_path: &str,
    install_path: &str,
) -> Result<(), String> {
    let version_hash = file_sha256(Path::new(zip_path))?;

    let mut file_hashes: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let extracted_dir = Path::new(project_path).join(install_path);
    if extracted_dir.exists() {
        for entry in walkdir::WalkDir::new(&extracted_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let rel = entry
                .path()
                .strip_prefix(&extracted_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let hash = file_sha256(entry.path()).unwrap_or_default();
            file_hashes.insert(rel, hash);
        }
    }

    let hashes_dir = Path::new(project_path).join(".vrcstudio").join("hashes");
    fs::create_dir_all(&hashes_dir).map_err(|e| e.to_string())?;
    let snapshot_path = hashes_dir.join(format!("{}.json", source_id));
    let snapshot_json = serde_json::to_string_pretty(&file_hashes).map_err(|e| e.to_string())?;
    fs::write(&snapshot_path, snapshot_json).map_err(|e| e.to_string())?;

    let mut manifest = read_manifest(project_path)?;
    manifest.dependency.retain(|d| d.source_id != source_id);
    manifest.dependency.push(BoothDepEntry {
        source: "booth".to_string(),
        source_id: source_id.to_string(),
        name: name.to_string(),
        author: author.to_string(),
        version_hash,
        install_path: install_path.to_string(),
        added_at: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        modified: false,
    });
    write_manifest(project_path, &manifest)?;
    booth_deps_update_gitignore_impl(project_path, install_path, true)
}

/// Adds (or updates) a Booth dependency entry in booth-deps.toml.
/// Also writes per-file hash snapshots to .vrcstudio/hashes/{source_id}.json
/// and appends install_path to .gitignore.
#[tauri::command]
pub fn booth_deps_add(
    project_path: String,
    source_id: String,
    name: String,
    author: String,
    zip_path: String,
    install_path: String,
) -> Result<(), String> {
    booth_deps_add_impl(&project_path, &source_id, &name, &author, &zip_path, &install_path)
}

/// Public Tauri command: add or remove install_path from .gitignore.
#[tauri::command]
pub fn booth_deps_update_gitignore(
    project_path: String,
    install_path: String,
    add: bool,
) -> Result<(), String> {
    booth_deps_update_gitignore_impl(&project_path, &install_path, add)
}

/// Compares current files in install_path against the saved hash snapshot.
/// For any dep where files have changed: sets modified=true in booth-deps.toml
/// and removes install_path from .gitignore (so git tracks those changes).
/// Returns the list of source_ids that were newly detected as modified.
#[tauri::command]
pub fn booth_deps_check_modifications(project_path: String) -> Result<Vec<String>, String> {
    let mut manifest = read_manifest(&project_path)?;
    let hashes_dir = Path::new(&project_path).join(".vrcstudio").join("hashes");
    let mut newly_modified: Vec<String> = vec![];

    for dep in manifest.dependency.iter_mut() {
        if dep.modified {
            continue;
        }

        let snapshot_path = hashes_dir.join(format!("{}.json", dep.source_id));
        if !snapshot_path.exists() {
            continue;
        }

        let snapshot_raw = fs::read_to_string(&snapshot_path).map_err(|e| e.to_string())?;
        let snapshot: std::collections::HashMap<String, String> =
            serde_json::from_str(&snapshot_raw).map_err(|e| e.to_string())?;

        let extracted_dir = Path::new(&project_path).join(&dep.install_path);
        if !extracted_dir.exists() {
            continue;
        }

        let mut is_modified = false;
        for entry in walkdir::WalkDir::new(&extracted_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let rel = entry
                .path()
                .strip_prefix(&extracted_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let current_hash = file_sha256(entry.path()).unwrap_or_default();
            let original_hash = snapshot.get(&rel).cloned().unwrap_or_default();

            if current_hash != original_hash {
                is_modified = true;
                break;
            }
        }

        if is_modified {
            dep.modified = true;
            newly_modified.push(dep.source_id.clone());
            booth_deps_update_gitignore_impl(&project_path, &dep.install_path, false)?;
        }
    }

    if !newly_modified.is_empty() {
        write_manifest(&project_path, &manifest)?;
    }

    Ok(newly_modified)
}

/// Clones a GitHub repository to the given destination path.
/// Returns an object with `path` (cloned dir) and `has_booth_deps` (bool).
#[derive(Debug, Serialize)]
pub struct CloneResult {
    pub path: String,
    pub has_booth_deps: bool,
}

#[tauri::command]
pub async fn project_clone_from_github(
    app: tauri::AppHandle,
    url: String,
    dest: String,
) -> Result<CloneResult, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let dest_path = Path::new(&dest);
    if dest_path.exists() {
        return Err(format!("Destination already exists: {dest}"));
    }

    let mut child = tokio::process::Command::new("git")
        .args(["clone", "--progress", &url, &dest])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start git: {e}"))?;

    // Stream progress lines as events so the UI can display them
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_clone.emit("booth-deps:clone-progress", &line);
            }
        });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(
            "git clone failed — check the URL and your network connection".to_string(),
        );
    }

    let has_booth_deps = dest_path.join("booth-deps.toml").exists();

    Ok(CloneResult {
        path: dest.clone(),
        has_booth_deps,
    })
}

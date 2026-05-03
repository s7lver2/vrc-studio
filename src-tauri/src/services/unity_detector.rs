use crate::models::UnityInstallation;
use std::path::{Path, PathBuf};

pub fn parse_version_from_path(path: &str) -> Option<String> {
    path.replace('\\', "/")
        .split('/')
        .find(|segment| {
            let parts: Vec<&str> = segment.splitn(3, '.').collect();
            if parts.len() < 2 {
                return false;
            }
            parts[0].parse::<u32>().is_ok()
                && parts[1].parse::<u32>().is_ok()
                && segment.contains('f')
        })
        .map(|s| s.to_string())
}

pub async fn detect_unity_installations() -> Vec<UnityInstallation> {
    let mut found: Vec<UnityInstallation> = Vec::new();

    for dir in known_unity_paths() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let version_dir = entry.path();
                if !version_dir.is_dir() { continue; }
                let exe = unity_exe_in_dir(&version_dir);
                if exe.exists() {
                    if let Some(version) = parse_version_from_path(version_dir.to_string_lossy().as_ref()) {
                        found.push(UnityInstallation { version, path: exe.to_string_lossy().to_string(), is_custom: false });
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    { found.extend(detect_from_registry()); }

    found.sort_by(|a, b| b.version.cmp(&a.version));
    found.dedup_by(|a, b| a.path == b.path);
    found
}

fn unity_exe_in_dir(dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return dir.join("Editor").join("Unity.exe");
    #[cfg(not(target_os = "windows"))]
    return dir.join("Unity.app").join("Contents").join("MacOS").join("Unity");
}

fn known_unity_paths() -> Vec<PathBuf> {
    let mut paths = vec![];
    if let Ok(pf) = std::env::var("PROGRAMFILES") {
        paths.push(PathBuf::from(pf).join("Unity/Hub/Editor"));
    }
    paths.push(PathBuf::from("/Applications/Unity/Hub/Editor"));
    if let Ok(home) = std::env::var("HOME") {
        paths.push(PathBuf::from(home).join("Unity/Hub/Editor"));
    }
    paths
}

#[cfg(target_os = "windows")]
fn detect_from_registry() -> Vec<UnityInstallation> {
    use winreg::enums::*;
    use winreg::RegKey;
    let mut result = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey("SOFTWARE\\Unity Technologies\\Installer") else { return result; };
    for name in key.enum_keys().flatten() {
        let Ok(sub) = key.open_subkey(&name) else { continue; };
        let Ok(loc): Result<String, _> = sub.get_value("Location x64") else { continue; };
        let exe = PathBuf::from(&loc).join("Editor").join("Unity.exe");
        if exe.exists() {
            if let Some(version) = parse_version_from_path(&loc) {
                result.push(UnityInstallation { version, path: exe.to_string_lossy().to_string(), is_custom: false });
            }
        }
    }
    result
}
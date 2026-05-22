//! Reads VPM repository URLs from VCC and alcom (vrc-get) configuration files.
//!
//! ## File locations (Windows)
//!
//! Both VCC and alcom store settings in the same folder:
//!   `%APPDATA%\VRChatCreatorCompanion\settings.json`
//!
//! alcom also checks:
//!   `%APPDATA%\vrc-get\settings.json`   (older vrc-get versions)
//!
//! ## JSON formats
//!
//! **VCC** uses:
//! ```json
//! { "userRepos": [{ "Url": "https://...", "LocalPath": "..." }] }
//! ```
//!
//! **alcom / vrc-get** uses:
//! ```json
//! {
//!   "user_repos": [
//!     {
//!       "local_path": "...",
//!       "creation_info": { "url": "https://...", "name": "..." }
//!     }
//!   ]
//! }
//! ```

use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;

// ── VCC model ─────────────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct VccSettings {
    #[serde(rename = "userRepos", default)]
    user_repos: Vec<VccRepo>,
}

#[derive(Deserialize, Default)]
struct VccRepo {
    /// PascalCase because VCC is C#
    #[serde(rename = "Url", default)]
    url: String,
}

// ── alcom / vrc-get model ─────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
struct AlcomSettings {
    #[serde(default)]
    user_repos: Vec<AlcomRepo>,
}

#[derive(Deserialize, Default)]
struct AlcomRepo {
    /// URL is nested under creation_info in vrc-get / alcom
    #[serde(default)]
    creation_info: Option<AlcomCreationInfo>,
    /// Older vrc-get format had url at the top level
    #[serde(default)]
    url: String,
}

#[derive(Deserialize, Default)]
struct AlcomCreationInfo {
    #[serde(default)]
    url: String,
}

// ── Pure parse functions (public for testing) ─────────────────────────────────

/// Parses a VCC `settings.json` and returns `userRepos[].Url` values.
pub fn parse_vcc_settings(json: &str) -> Vec<String> {
    let Ok(s) = serde_json::from_str::<VccSettings>(json) else {
        return vec![];
    };
    s.user_repos
        .into_iter()
        .map(|r| r.url.trim().to_string())
        .filter(|u| !u.is_empty())
        .collect()
}

/// Parses an alcom/vrc-get `settings.json` and returns all repo URLs.
/// Handles both the current nested `creation_info.url` format and the
/// older flat `url` format.
pub fn parse_alcom_settings(json: &str) -> Vec<String> {
    let Ok(s) = serde_json::from_str::<AlcomSettings>(json) else {
        return vec![];
    };
    s.user_repos
        .into_iter()
        .map(|r| {
            // Prefer nested creation_info.url (current format)
            if let Some(info) = r.creation_info {
                if !info.url.is_empty() {
                    return info.url.trim().to_string();
                }
            }
            // Fall back to top-level url (older format)
            r.url.trim().to_string()
        })
        .filter(|u| !u.is_empty())
        .collect()
}

/// Busca configuraciones de VCC / alcom consultando el Registro de Windows.
/// Devuelve pares (PathBuf, parser_fn) listos para fusionar con `config_candidates()`.
#[cfg(target_os = "windows")]
fn registry_candidates() -> Vec<(PathBuf, fn(&str) -> Vec<String>)> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut found: Vec<(PathBuf, fn(&str) -> Vec<String>)> = Vec::new();

    // ── 1. Claves de software directas ────────────────────────────────────
    let direct_keys = [
        ("SOFTWARE\\AlcomByVRCGet", "DataDir", parse_alcom_settings as fn(&str) -> Vec<String>),
        ("SOFTWARE\\vrc-get", "DataDir", parse_alcom_settings as fn(&str) -> Vec<String>),
        ("SOFTWARE\\VRChatCreatorCompanion", "DataDir", parse_vcc_settings as fn(&str) -> Vec<String>),
    ];

    for (key_path, value_name, parser) in &direct_keys {
        for hive in [
            RegKey::predef(HKEY_CURRENT_USER),
            RegKey::predef(HKEY_LOCAL_MACHINE),
        ] {
            if let Ok(key) = hive.open_subkey(key_path) {
                if let Ok(dir) = key.get_value::<String, _>(value_name) {
                    let candidate = PathBuf::from(&dir).join("settings.json");
                    if !found.iter().any(|(p, _)| p == &candidate) {
                        found.push((candidate, *parser));
                    }
                }
            }
        }
    }

    // ── 2. Claves de desinstalación (HKCU y HKLM) ────────────────────────
    let uninstall_keys = [
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];

    // Nombres de aplicación que reconocemos, con el parser correspondiente
    let known_apps: &[(&str, fn(&str) -> Vec<String>)] = &[
        ("VRChat Creator Companion", parse_vcc_settings as fn(&str) -> Vec<String>),
        ("VRChatCreatorCompanion",   parse_vcc_settings as fn(&str) -> Vec<String>),
        ("alcom",                    parse_alcom_settings as fn(&str) -> Vec<String>),
        ("AlcomByVRCGet",            parse_alcom_settings as fn(&str) -> Vec<String>),
        ("vrc-get",                  parse_alcom_settings as fn(&str) -> Vec<String>),
    ];

    for uninstall_path in &uninstall_keys {
        for hive in [
            RegKey::predef(HKEY_CURRENT_USER),
            RegKey::predef(HKEY_LOCAL_MACHINE),
        ] {
            let Ok(uninstall_key) = hive.open_subkey(uninstall_path) else { continue };
            for subkey_name in uninstall_key.enum_keys().flatten() {
                let Ok(subkey) = uninstall_key.open_subkey(&subkey_name) else { continue };

                let display_name: String = subkey
                    .get_value("DisplayName")
                    .unwrap_or_default();

                let Some((_app_name, parser)) = known_apps
                    .iter()
                    .find(|(n, _)| display_name.contains(n))
                else {
                    continue;
                };

                // Intentar obtener directorio de datos desde InstallLocation
                if let Ok(install_loc) = subkey.get_value::<String, _>("InstallLocation") {
                    let base = PathBuf::from(&install_loc);
                    // Posibles ubicaciones relativas al directorio de instalación
                    for rel in &["settings.json", "data/settings.json", "config/settings.json"] {
                        let candidate = base.join(rel);
                        if !found.iter().any(|(p, _)| p == &candidate) {
                            found.push((candidate, *parser));
                        }
                    }
                }
            }
        }
    }

    found
}

/// Versión no-Windows: devuelve vacío (sin registro)
#[cfg(not(target_os = "windows"))]
fn registry_candidates() -> Vec<(PathBuf, fn(&str) -> Vec<String>)> {
    vec![]
}

// ── Path discovery ────────────────────────────────────────────────────────────

/// Candidate paths to check, in priority order.
/// Returns (path, parser_fn) pairs.
fn config_candidates() -> Vec<(PathBuf, fn(&str) -> Vec<String>)> {
    let mut candidates = Vec::new();

    // ── APPDATA locations ─────────────────────────────────────────────────
    if let Ok(appdata) = std::env::var("APPDATA") {
        let base = PathBuf::from(&appdata);

        // VCC y alcom (≤0.x) comparten esta carpeta
        let vcc_shared = base.join("VRChatCreatorCompanion").join("settings.json");
        candidates.push((vcc_shared.clone(), parse_alcom_settings as fn(&str) -> Vec<String>));
        candidates.push((vcc_shared, parse_vcc_settings as fn(&str) -> Vec<String>));

        // alcom antiguo (standalone vrc-get)
        candidates.push((
            base.join("vrc-get").join("settings.json"),
            parse_alcom_settings as fn(&str) -> Vec<String>,
        ));

        // alcom ≥ 1.x en APPDATA
        candidates.push((
            base.join("AlcomByVRCGet").join("settings.json"),
            parse_alcom_settings as fn(&str) -> Vec<String>,
        ));
    }

    // ── LOCALAPPDATA locations ────────────────────────────────────────────
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let base = PathBuf::from(&local);

        // VCC en LOCALAPPDATA
        candidates.push((
            base.join("VRChatCreatorCompanion").join("settings.json"),
            parse_vcc_settings as fn(&str) -> Vec<String>,
        ));

        // alcom ≥ 1.x en LOCALAPPDATA (ruta principal actual)
        let alcom_local = base.join("AlcomByVRCGet").join("settings.json");
        candidates.push((alcom_local.clone(), parse_alcom_settings as fn(&str) -> Vec<String>));

        // alcom instalado en Programs (NSIS installer)
        candidates.push((
            base.join("Programs").join("alcom").join("settings.json"),
            parse_alcom_settings as fn(&str) -> Vec<String>,
        ));
    }

    // ── USERPROFILE / HOME locations ──────────────────────────────────────
    let home_var = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok();
    if let Some(home) = home_var {
        candidates.push((
            PathBuf::from(&home).join(".vrc-get").join("settings.json"),
            parse_alcom_settings as fn(&str) -> Vec<String>,
        ));
    }

    candidates
}

// ── Main public API ───────────────────────────────────────────────────────────

/// Reads VPM repository URLs from all known tool configs (VCC, alcom).
/// Silently ignores missing or malformed files.
/// Deduplicates the result; does NOT include the official VRChat URL.
pub fn read_external_vpm_sources() -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out: Vec<String> = Vec::new();

    // Rutas conocidas (env vars)
    let mut all_candidates = config_candidates();
    // Rutas descubiertas desde el Registro de Windows
    all_candidates.extend(registry_candidates());

    for (path, parser) in all_candidates {
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        for url in parser(&content) {
            if seen.insert(url.clone()) {
                out.push(url);
            }
        }
    }

    out
}

/// Returns diagnostic info: which config files were found and what URLs each contained.
/// Used by the `debug_vcc_sources` command for troubleshooting.
pub fn diagnose() -> Vec<(String, Vec<String>)> {
    let mut result = Vec::new();
    let mut all_candidates = config_candidates();
    all_candidates.extend(registry_candidates());

    for (path, parser) in all_candidates {
        let path_str = path.display().to_string();
        match std::fs::read_to_string(&path) {
            Err(_) => {
                result.push((format!("{path_str} [NOT FOUND]"), vec![]));
            }
            Ok(content) => {
                let urls = parser(&content);
                result.push((path_str, urls));
            }
        }
    }
    result
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_vcc_settings_extracts_user_repo_urls() {
        let json = r#"{
            "userRepos": [
                { "Url": "https://vcc.vrcfury.com/", "LocalPath": "/some/path" },
                { "Url": "https://vpm.nadena.dev/vpm.json", "LocalPath": "/another" }
            ]
        }"#;
        let urls = parse_vcc_settings(json);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://vcc.vrcfury.com/".to_string()));
        assert!(urls.contains(&"https://vpm.nadena.dev/vpm.json".to_string()));
    }

    #[test]
    fn parse_vcc_settings_ignores_empty_urls() {
        let json = r#"{ "userRepos": [{ "Url": "", "LocalPath": "/x" }] }"#;
        assert_eq!(parse_vcc_settings(json).len(), 0);
    }

    #[test]
    fn parse_vcc_settings_handles_missing_field() {
        let json = r#"{ "someOtherField": 42 }"#;
        assert_eq!(parse_vcc_settings(json).len(), 0);
    }

    #[test]
    fn parse_alcom_nested_creation_info() {
        // Current alcom / vrc-get format
        let json = r#"{
            "user_repos": [
                {
                    "local_path": "C:\\cache\\lilxyzw.json",
                    "creation_info": {
                        "url": "https://lilxyzw.github.io/vpm-repos/vpm.json",
                        "name": "lilxyzw"
                    }
                },
                {
                    "local_path": "C:\\cache\\wholesome.json",
                    "creation_info": {
                        "url": "https://wholesomevr.github.io/vpm/index.json",
                        "name": "wholesome"
                    }
                }
            ]
        }"#;
        let urls = parse_alcom_settings(json);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://lilxyzw.github.io/vpm-repos/vpm.json".to_string()));
        assert!(urls.contains(&"https://wholesomevr.github.io/vpm/index.json".to_string()));
    }

    #[test]
    fn parse_alcom_flat_url_fallback() {
        // Older vrc-get format: url at top level
        let json = r#"{
            "user_repos": [
                { "url": "https://vpm.nadena.dev/vpm.json" }
            ]
        }"#;
        let urls = parse_alcom_settings(json);
        assert_eq!(urls.len(), 1);
        assert!(urls.contains(&"https://vpm.nadena.dev/vpm.json".to_string()));
    }

    #[test]
    fn parse_alcom_empty_gracefully() {
        assert_eq!(parse_alcom_settings(r#"{}"#).len(), 0);
    }

    #[test]
    fn parse_alcom_prefers_creation_info_over_flat() {
        // If both are present, creation_info.url wins
        let json = r#"{
            "user_repos": [
                {
                    "url": "https://old.example.com/",
                    "creation_info": { "url": "https://new.example.com/" }
                }
            ]
        }"#;
        let urls = parse_alcom_settings(json);
        assert_eq!(urls, vec!["https://new.example.com/"]);
    }
    #[test]
    fn parse_alcom_empty_creation_info_url_is_skipped() {
        // Asegura que un repo con creation_info pero url vacía se filtra
        let json = r#"{
            "user_repos": [
                { "local_path": "C:\\x.json", "creation_info": { "url": "", "name": "empty" } },
                { "local_path": "C:\\y.json", "creation_info": { "url": "https://valid.example.com/index.json", "name": "valid" } }
            ]
        }"#;
        let urls = parse_alcom_settings(json);
        assert_eq!(urls.len(), 1);
        assert_eq!(urls[0], "https://valid.example.com/index.json");
    }

    #[test]
    fn parse_vcc_settings_handles_mixed_empty_and_valid() {
        let json = r#"{
            "userRepos": [
                { "Url": "", "LocalPath": "/x" },
                { "Url": "https://real.example.com/vpm.json", "LocalPath": "/y" },
                { "Url": "   ", "LocalPath": "/z" }
            ]
        }"#;
        let urls = parse_vcc_settings(json);
        assert_eq!(urls.len(), 1);
        assert_eq!(urls[0], "https://real.example.com/vpm.json");
    }
    #[test]
    fn registry_candidates_returns_vec() {
        // En cualquier OS simplemente no explota
        let _ = registry_candidates();
    }
}
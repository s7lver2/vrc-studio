use crate::models::UnityInstallation;
use std::path::{Path, PathBuf};

pub fn parse_version_from_path(path: &str) -> Option<String> {
    path.replace('\\', "/")
        .split('/')
        .find_map(|segment| {
            // Soporta tanto "2022.3.22f1" como "Unity 2022.3.22f1"
            let candidate = segment.strip_prefix("Unity ").unwrap_or(segment);
            let parts: Vec<&str> = candidate.splitn(3, '.').collect();
            if parts.len() < 2 { return None; }
            if parts[0].parse::<u32>().is_err() { return None; }
            if parts[1].parse::<u32>().is_err() { return None; }
            if !candidate.contains('f') { return None; }
            Some(candidate.to_string())
        })
}

pub async fn detect_unity_installations() -> Vec<UnityInstallation> {
    let mut found: Vec<UnityInstallation> = Vec::new();

    for dir in known_unity_paths() {
        eprintln!("[unity_detector] Probando: {}", dir.display());
        match std::fs::read_dir(&dir) {
            Err(e) => eprintln!("[unity_detector]   → no accesible: {e}"),
            Ok(entries) => {
                for entry in entries.flatten() {
                    let version_dir = entry.path();
                    if !version_dir.is_dir() { continue; }
                    let exe = unity_exe_in_dir(&version_dir);
                    if exe.exists() {
                        if let Some(version) = parse_version_from_path(version_dir.to_string_lossy().as_ref()) {
                            eprintln!("[unity_detector]   → ✓ {} @ {}", version, exe.display());
                            found.push(UnityInstallation { version, path: exe.to_string_lossy().to_string(), is_custom: false });
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Scan de carpetas "Unity*" en Program Files (cubre instalaciones standalone)
        let pf_roots: Vec<String> = [
            std::env::var("PROGRAMFILES").ok(),
            Some(r"C:\Program Files".to_string()),        // fallback si env var falta
            std::env::var("PROGRAMFILES(X86)").ok(),
            Some(r"C:\Program Files (x86)".to_string()),  // fallback x86
        ]
        .into_iter()
        .flatten()
        .collect::<std::collections::HashSet<_>>() // deduplicar
        .into_iter()
        .collect();

        for root in &pf_roots {
            found.extend(scan_dir_for_standalone_unity(std::path::Path::new(root)));
        }

        found.extend(detect_from_registry());
        found.extend(detect_from_unity_hub_editors_json());
    }

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

    // Windows: leer de env vars (preferido; resuelve casos de instalación en unidad distinta)
    if let Ok(pf) = std::env::var("PROGRAMFILES") {
        paths.push(PathBuf::from(&pf).join("Unity").join("Hub").join("Editor"));
        paths.push(PathBuf::from(&pf).join("Unity"));
        // Unity Hub 3.x puede instalarse como "Unity Hub" (con espacio)
        paths.push(PathBuf::from(&pf).join("Unity Hub").join("Editor"));
    } else {
        eprintln!("[unity_detector] WARN: PROGRAMFILES no encontrado en el entorno del proceso");
    }
    if let Ok(pf86) = std::env::var("PROGRAMFILES(X86)") {
        paths.push(PathBuf::from(pf86).join("Unity").join("Hub").join("Editor"));
    }

    // Windows: fallback hardcoded — cubre el caso en que PROGRAMFILES no está disponible
    // (algunos contextos de Tauri o instalaciones con UAC no heredan todas las env vars)
    #[cfg(target_os = "windows")]
    {
        for p in [
            r"C:\Program Files\Unity\Hub\Editor",
            r"C:\Program Files\Unity Hub\Editor",
            r"C:\Program Files (x86)\Unity\Hub\Editor",
        ] {
            let pb = PathBuf::from(p);
            if !paths.iter().any(|x| x == &pb) {
                paths.push(pb);
            }
        }
    }

    // macOS
    paths.push(PathBuf::from("/Applications/Unity/Hub/Editor"));
    paths.push(PathBuf::from("/Applications/Unity"));

    // Linux / macOS home
    if let Ok(home) = std::env::var("HOME") {
        paths.push(PathBuf::from(&home).join("Unity").join("Hub").join("Editor"));
        paths.push(PathBuf::from(&home).join("Applications").join("Unity"));
    }

    paths
}

/// Escanea `root` (e.g. `C:\Program Files`) buscando carpetas cuyo nombre
/// empieza por "Unity" que contengan directamente `Editor\Unity.exe`.
/// Cubre instalaciones standalone como `C:\Program Files\Unity 2022.3.22f1\`.
#[cfg(target_os = "windows")]
fn scan_dir_for_standalone_unity(root: &Path) -> Vec<UnityInstallation> {
    let mut result = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        eprintln!("[unity_detector] scan_dir: no accesible {}", root.display());
        return result;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let name = match dir.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Solo carpetas que empiecen por "Unity" (incluye "Unity 2022.3.22f1", "Unity2019", etc.)
        if !name.starts_with("Unity") { continue; }
        let exe = dir.join("Editor").join("Unity.exe");
        if !exe.is_file() { continue; }
        let version = parse_version_from_path(dir.to_string_lossy().as_ref())
            .unwrap_or_else(|| name.clone());
        eprintln!("[unity_detector] standalone: {} @ {}", version, exe.display());
        result.push(UnityInstallation {
            version,
            path: exe.to_string_lossy().to_string(),
            is_custom: false,
        });
    }
    result
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

/// Parsea %APPDATA%\UnityHub\editors.json para detectar editores instalados
/// desde Unity Hub a rutas no estándar (e.g. otra unidad, carpeta custom).
///
/// Unity Hub 3.x guarda el JSON con este esquema:
/// ```json
/// {
///   "2022.3.22f1": {
///     "version": "2022.3.22f1",
///     "location": ["C:\\ruta\\a\\Unity.exe", true]
///   }
/// }
/// ```
#[cfg(target_os = "windows")]
fn detect_from_unity_hub_editors_json() -> Vec<UnityInstallation> {
    let mut result = Vec::new();

    let candidates = [
        std::env::var("APPDATA").map(|d| PathBuf::from(d).join("UnityHub").join("editors.json")),
        std::env::var("LOCALAPPDATA").map(|d| PathBuf::from(d).join("UnityHub").join("editors.json")),
    ];

    for candidate in candidates.into_iter().flatten() {
        eprintln!("[unity_detector] Probando editors.json: {}", candidate.display());
        if !candidate.exists() {
            eprintln!("[unity_detector]   → No existe");
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&candidate) else {
            eprintln!("[unity_detector]   → Error al leer");
            continue;
        };
        let Ok(json): Result<serde_json::Value, _> = serde_json::from_str(&content) else {
            eprintln!("[unity_detector]   → JSON inválido");
            continue;
        };
        let Some(obj) = json.as_object() else { continue; };

        for (version_key, entry) in obj {
            // location puede ser: array ["path", bool], string, o tener la clave "manual"
            let exe_path_str = if let Some(arr) = entry.get("location").and_then(|v| v.as_array()) {
                arr.first().and_then(|v| v.as_str()).map(|s| s.to_string())
            } else if let Some(s) = entry.get("location").and_then(|v| v.as_str()) {
                Some(s.to_string())
            } else if let Some(s) = entry.get("manual").and_then(|v| v.as_str()) {
                // Algunos hubs usan "manual" para instalaciones personalizadas
                Some(s.to_string())
            } else {
                eprintln!("[unity_detector]   → {} sin location/manual", version_key);
                None
            };

            let Some(exe_str) = exe_path_str else { continue; };
            eprintln!("[unity_detector]   → {} path base: {}", version_key, exe_str);
            let exe = PathBuf::from(&exe_str);

            // Resolver ruta al ejecutable en múltiples variantes
            let candidates_exe = vec![
                exe.clone(),                                        // la ruta tal cual (puede ser el .exe)
                exe.join("Editor").join("Unity.exe"),               // carpeta raíz → Editor/Unity.exe
                exe.join("Unity.exe"),                              // carpeta Editor → Unity.exe
                PathBuf::from(&exe_str).parent().map(|p| p.join("Unity.exe")).unwrap_or_default(),
            ];

            let found_exe = candidates_exe.into_iter().find(|p| p.is_file());
            let Some(final_exe) = found_exe else {
                eprintln!("[unity_detector]   → {} ejecutable no encontrado en ninguna variante", version_key);
                continue;
            };

            eprintln!("[unity_detector]   → {} OK: {}", version_key, final_exe.display());
            let version = parse_version_from_path(final_exe.to_string_lossy().as_ref())
                .unwrap_or_else(|| version_key.clone());

            // Evitar duplicados en este loop
            if result.iter().all(|i: &UnityInstallation| i.path != final_exe.to_string_lossy().as_ref()) {
                result.push(UnityInstallation {
                    version,
                    path: final_exe.to_string_lossy().to_string(),
                    is_custom: false,
                });
            }
        }
        // FIX: anteriormente hacía `if !result.is_empty() { break; }` lo que saltaba
        // LOCALAPPDATA si APPDATA encontraba algo. Ahora leemos AMBOS y deduplicamos.
        // No hay break aquí — seguimos con el siguiente candidato.
    }

    result
}
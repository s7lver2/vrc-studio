use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use semver::Version;

// ──────────────────────────────────────────────────────────────────────────────
//  Tipos públicos (también usados por los tests de integración)
// ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct PlatformAsset {
    pub url:       String,
    pub signature: String,
    pub size:      u64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateManifest {
    pub version:   String,
    pub channel:   String,
    pub pub_date:  String,
    pub notes:     String,
    pub platforms: HashMap<String, PlatformAsset>,

    // Campos opcionales de flags de release
    #[serde(default)]
    pub forced_onboarding_version: Option<String>,
    #[serde(default)]
    pub whats_new_version:   Option<String>,
    #[serde(default)]
    pub whats_new_changelog: Option<String>,
}

/// Devuelve true si `remote` > `current` (semver).
/// Ignora errores de parseo — si no es semver válido, devuelve false.
pub fn compare_versions(remote: &str, current: &str) -> bool {
    match (Version::parse(remote), Version::parse(current)) {
        (Ok(r), Ok(c)) => r > c,
        _ => false,
    }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Constantes de build (baked in por build.py en tiempo de compilación)
// ──────────────────────────────────────────────────────────────────────────────

/// URL base del manifiesto.  Se obtiene de la env var VRC_UPDATE_URL
/// inyectada por build.py, o usa la URL de GitHub Releases como fallback.
fn update_manifest_url(channel: &str) -> String {
    // La variable VRCSTUDIO_UPDATE_BASE_URL se puede inyectar vía RUSTFLAGS
    // en build.py para apuntar a un servidor propio.
    let base = option_env!("VRCSTUDIO_UPDATE_BASE_URL")
        .unwrap_or("https://github.com/tu-usuario/vrc-studio/releases/latest/download");
    format!("{}/update-{}.json", base, channel)
}

/// Clave pública Ed25519 para el canal stable (base64, 32 bytes raw).
/// Se genera con:  python build.py gen-keys
/// y se pega aquí antes de compilar.
const STABLE_PUBKEY_B64:  &str = "REEMPLAZAR_CON_CLAVE_PUBLICA_STABLE";
const TESTING_PUBKEY_B64: &str = "REEMPLAZAR_CON_CLAVE_PUBLICA_TESTING";

fn pubkey_for_channel(channel: &str) -> &'static str {
    if channel == "testing" { TESTING_PUBKEY_B64 } else { STABLE_PUBKEY_B64 }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Verificación de firma Ed25519
// ──────────────────────────────────────────────────────────────────────────────

/// Devuelve Ok(()) si la firma es válida, Err(mensaje) si no.
fn verify_signature(data: &[u8], sig_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    use base64::Engine;
    use ed25519_dalek::{Signature, VerifyingKey, Verifier};

    let pub_bytes = base64::engine::general_purpose::STANDARD
        .decode(pubkey_b64)
        .map_err(|e| format!("pubkey decode: {e}"))?;

    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(sig_b64)
        .map_err(|e| format!("signature decode: {e}"))?;

    let vk = VerifyingKey::from_bytes(
        pub_bytes.as_slice().try_into().map_err(|_| "pubkey must be 32 bytes".to_string())?,
    ).map_err(|e| format!("pubkey parse: {e}"))?;

    let sig = Signature::from_bytes(
        sig_bytes.as_slice().try_into().map_err(|_| "signature must be 64 bytes".to_string())?,
    );

    vk.verify(data, &sig).map_err(|_| "invalid signature".to_string())
}

// ──────────────────────────────────────────────────────────────────────────────
//  Plataforma del host
// ──────────────────────────────────────────────────────────────────────────────

fn host_platform_key() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))] { "windows-amd64" }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]  { "windows-arm64" }
    #[cfg(all(target_os = "linux",   target_arch = "x86_64"))] { "linux-amd64" }
    #[cfg(all(target_os = "linux",   target_arch = "aarch64"))] { "linux-arm64" }
    #[cfg(all(target_os = "macos",   target_arch = "x86_64"))] { "darwin-amd64" }
    #[cfg(all(target_os = "macos",   target_arch = "aarch64"))] { "darwin-arm64" }
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "linux",   target_arch = "x86_64"),
        all(target_os = "linux",   target_arch = "aarch64"),
        all(target_os = "macos",   target_arch = "x86_64"),
        all(target_os = "macos",   target_arch = "aarch64"),
    )))] { "unknown" }
}

// ──────────────────────────────────────────────────────────────────────────────
//  Tauri Commands
// ──────────────────────────────────────────────────────────────────────────────

/// Resultado de la comprobación.  El frontend decide qué mostrar.
#[derive(Serialize)]
pub struct UpdateCheckResult {
    pub has_update:      bool,
    pub current_version: String,
    pub remote_version:  String,
    pub notes:           String,
    pub download_url:    String,
    pub signature:       String,
    pub download_size:   u64,
    /// forcedOnboardingVersion del manifiesto (si hay).
    pub forced_onboarding_version: Option<String>,
    /// whatsNewVersion del manifiesto (si hay).
    pub whats_new_version:   Option<String>,
    pub whats_new_changelog: Option<String>,
}

#[tauri::command]
pub async fn check_for_update(channel: Option<String>) -> Result<UpdateCheckResult, String> {
    let channel = channel.as_deref().unwrap_or("stable");
    let current = env!("CARGO_PKG_VERSION");
    let url = update_manifest_url(channel);

    let client = reqwest::Client::builder()
        .user_agent(format!("vrc-studio/{}", current))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let manifest: UpdateManifest = client
        .get(&url)
        .send().await.map_err(|e| format!("network: {e}"))?
        .json().await.map_err(|e| format!("parse: {e}"))?;

    let has_update = compare_versions(&manifest.version, current);
    let pk = host_platform_key();
    let asset = manifest.platforms.get(pk).cloned().unwrap_or(PlatformAsset {
        url:       String::new(),
        signature: String::new(),
        size:      0,
    });

    Ok(UpdateCheckResult {
        has_update,
        current_version: current.to_string(),
        remote_version:  manifest.version.clone(),
        notes:           manifest.notes.clone(),
        download_url:    asset.url,
        signature:       asset.signature,
        download_size:   asset.size,
        forced_onboarding_version: manifest.forced_onboarding_version,
        whats_new_version:   manifest.whats_new_version,
        whats_new_changelog: manifest.whats_new_changelog,
    })
}

/// Descarga el instalador/archivo al directorio temporal del sistema,
/// verifica la firma Ed25519, y lanza el instalador.
/// En Windows lanza el .exe con ShellExecute (pide UAC si es necesario).
/// En Linux descomprime el .tar.gz y lanza install.sh.
/// En macOS abre el .dmg.
#[tauri::command]
pub async fn download_and_install_update(
    url:       String,
    signature: String,
    channel:   Option<String>,
) -> Result<(), String> {
    let channel = channel.as_deref().unwrap_or("stable");
    let pubkey  = pubkey_for_channel(channel);

    // ── Descarga al directorio temporal ──────────────────────────────────────
    let fname = url.split('/').last().unwrap_or("vrc-studio-update");
    let tmp_dir  = std::env::temp_dir();
    let tmp_path = tmp_dir.join(fname);

    let client = reqwest::Client::builder()
        .user_agent(format!("vrc-studio/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(&url)
        .send().await.map_err(|e| format!("download: {e}"))?
        .bytes().await.map_err(|e| format!("download bytes: {e}"))?;

    // ── Verificar firma antes de escribir al disco ────────────────────────────
    // Si la clave pública es el placeholder, saltamos la verificación en modo dev
    if pubkey != "REEMPLAZAR_CON_CLAVE_PUBLICA_STABLE"
        && pubkey != "REEMPLAZAR_CON_CLAVE_PUBLICA_TESTING"
        && !signature.is_empty()
    {
        verify_signature(&bytes, &signature, pubkey)?;
    }

    std::fs::write(&tmp_path, &bytes).map_err(|e| format!("write: {e}"))?;

    // ── Lanzar instalador ─────────────────────────────────────────────────────
    #[cfg(target_os = "windows")]
    {
        // ShellExecute abre el .exe con el nivel de permisos correcto
        // (solicita UAC si el instalador lo requiere).
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &tmp_path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("launch installer: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&tmp_path)
            .spawn()
            .map_err(|e| format!("open dmg: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        // El .tar.gz se extrae en /tmp y se lanza install.sh
        let extract_dir = tmp_dir.join("vrc-studio-update-extract");
        std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
        std::process::Command::new("tar")
            .args(["xzf", &tmp_path.to_string_lossy(), "-C", &extract_dir.to_string_lossy()])
            .status()
            .map_err(|e| format!("tar: {e}"))?;
        let install_sh = extract_dir.join("install.sh");
        if install_sh.exists() {
            std::process::Command::new("bash")
                .arg(&install_sh)
                .spawn()
                .map_err(|e| format!("install.sh: {e}"))?;
        }
    }

    Ok(())
}
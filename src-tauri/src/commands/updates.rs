use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use semver::Version;
use crate::db::DbPool;
use tauri::State;
use chrono;

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
        .unwrap_or("https://github.com/s7lver2/vrc-studio/releases/latest/download");
    format!("{}/update-{}.json", base, channel)
}

/// Clave pública Ed25519 para el canal stable (base64, 32 bytes raw).
/// Se genera con:  python build.py gen-keys
/// y se pega aquí antes de compilar.
const STABLE_PUBKEY_B64:  &str = "vD8PMhYn9r8QpooB5f6rzfXi6ChhSufRfzMZg/GpNro=";
const TESTING_PUBKEY_B64: &str = "/Cv2qdVuYKzNeaGzsipGIsZ1wOIeORSwCgOM+jcxmzE=";

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

fn no_update(current: &str) -> UpdateCheckResult {
    UpdateCheckResult {
        has_update:                  false,
        current_version:             current.to_string(),
        remote_version:              current.to_string(),
        notes:                       String::new(),
        download_url:                String::new(),
        signature:                   String::new(),
        download_size:               0,
        forced_onboarding_version:   None,
        whats_new_version:           None,
        whats_new_changelog:         None,
    }
}

/// Checks GitHub Releases API for a newer version on the given channel.
/// For private beta channels, pass beta_build = current installed build number.
/// Falls back gracefully on network errors or when no releases exist.
#[tauri::command]
pub async fn check_for_update(
    channel:    Option<String>,
    beta_build: Option<u64>,
) -> Result<UpdateCheckResult, String> {
    let channel  = channel.as_deref().unwrap_or("stable");
    let current  = env!("CARGO_PKG_VERSION");
    let platform = host_platform_key();
    let url      = github_api_releases_url();

    let client = reqwest::Client::builder()
        .user_agent(format!("vrc-studio/{}", current))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url).send().await
        .map_err(|e| format!("network: {e}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(no_update(current));
    }
    if !response.status().is_success() {
        return Err(format!("server error: HTTP {}", response.status()));
    }

    let body = response.text().await.map_err(|e| format!("read: {e}"))?;
    let releases: Vec<GhRelease> = serde_json::from_str(&body)
        .map_err(|e| format!("parse: {e} — body was: {}", &body[..body.len().min(200)]))?;

    // ── Private beta channel ─────────────────────────────────────────────
    if is_beta_channel(channel) {
        let slug           = channel;
        let current_build  = beta_build.unwrap_or(0);
        let latest = releases.into_iter()
            .filter_map(|r| {
                let build = beta_build_number(&r.tag_name, slug)?;
                let asset = r.assets.iter()
                    .find(|a| asset_matches_platform(&a.name, platform))?;
                Some((build, r.body.unwrap_or_default(),
                      asset.browser_download_url.clone(), asset.size))
            })
            .max_by_key(|(build, ..)| *build);

        let Some((build_num, notes, download_url, size)) = latest else {
            return Ok(no_update(current));
        };
        return Ok(UpdateCheckResult {
            has_update:                  build_num > current_build,
            current_version:             current_build.to_string(),
            remote_version:              build_num.to_string(),
            notes,
            download_url,
            signature:                   String::new(),
            download_size:               size,
            forced_onboarding_version:   None,
            whats_new_version:           None,
            whats_new_changelog:         None,
        });
    }

    // ── Stable / Testing ─────────────────────────────────────────────────
    // Find the newest release for this channel that has a platform-specific installer asset
    let latest = releases.into_iter()
        .filter(|r| !is_private_beta_tag(&r.tag_name)) // exclude private betas
        .filter(|r| channel_from_tag(&r.tag_name, r.prerelease) == channel)
        .filter_map(|r| {
            let asset = r.assets.iter()
                .find(|a| asset_matches_platform(&a.name, platform))?;
            let version = r.tag_name
                .trim_start_matches('v')
                .trim_end_matches("-testing")
                .trim_end_matches("-beta")
                .trim_end_matches("-alpha")
                .to_string();
            Some((version, r.body.unwrap_or_default(), asset.browser_download_url.clone(), asset.size))
        })
        .next(); // GitHub returns releases newest-first

    let Some((remote_version, notes, download_url, size)) = latest else {
        return Ok(no_update(current));
    };

    let has_update = compare_versions(&remote_version, current);

    Ok(UpdateCheckResult {
        has_update,
        current_version:             current.to_string(),
        remote_version,
        notes,
        download_url,
        signature:                   String::new(),
        download_size:               size,
        forced_onboarding_version:   None,
        whats_new_version:           None,
        whats_new_changelog:         None,
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

// ──────────────────────────────────────────────────────────────────────────────
//  GitHub Releases API — listar versiones disponibles
// ──────────────────────────────────────────────────────────────────────────────

fn github_api_releases_url() -> &'static str {
    option_env!("VRCSTUDIO_GITHUB_API_RELEASES")
        .unwrap_or("https://api.github.com/repos/s7lver2/vrc-studio/releases?per_page=20")
}

/// Detecta el canal a partir del tag y el flag prerelease de GitHub.
/// Público para que los tests de integración puedan usarlo.
pub fn channel_from_tag(tag: &str, prerelease: bool) -> &'static str {
    // Private beta tags (beta-<slug>-<N>) must NOT be treated as testing
    if is_private_beta_tag(tag) {
        return "beta-private";
    }
    if prerelease
        || tag.contains("testing")
        || tag.contains("beta")
        || tag.contains("alpha")
    {
        "testing"
    } else {
        "stable"
    }
}

/// Returns true for private beta tags of the form beta-<slug>-<number>.
/// These are distinct from the public "testing" channel.
pub fn is_private_beta_tag(tag: &str) -> bool {
    if !tag.starts_with("beta-") { return false; }
    // Must end with a numeric build number: beta-<slug>-<N>
    tag.rsplitn(2, '-').next()
        .and_then(|tail| tail.parse::<u64>().ok())
        .is_some()
}

/// Returns true if the channel is a private beta slug (not "stable" or "testing").
pub fn is_beta_channel(channel: &str) -> bool {
    channel != "stable" && channel != "testing"
}

/// Extracts build number from a beta tag: "beta-<slug>-<N>" → Some(N)
pub fn beta_build_number(tag: &str, slug: &str) -> Option<u64> {
    let prefix = format!("beta-{slug}-");
    tag.strip_prefix(&prefix)?.parse::<u64>().ok()
}

/// Compare beta build numbers: remote > current_build
pub fn compare_beta_versions(remote: &str, current_build: u64) -> bool {
    remote.parse::<u64>().map(|r| r > current_build).unwrap_or(false)
}

/// Comprueba si el nombre de un asset de GitHub corresponde a la plataforma indicada.
/// Público para los tests.
pub fn asset_matches_platform(asset_name: &str, platform_key: &str) -> bool {
    asset_name.contains(platform_key)
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name:     String,
    prerelease:   bool,
    published_at: String,
    body:         Option<String>,
    assets:       Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name:                 String,
    browser_download_url: String,
    size:                 u64,
}

/// Versión publicada con el asset descargable para la plataforma actual.
#[derive(Debug, Serialize, Clone)]
pub struct AvailableVersion {
    pub version:       String,
    pub channel:       String,
    pub pub_date:      String,
    pub notes:         String,
    pub download_url:  String,
    pub download_size: u64,
    /// true si esta versión es la que está corriendo ahora mismo.
    pub is_current:    bool,
}

/// Devuelve la lista de versiones publicadas en GitHub para el canal indicado,
/// filtradas por plataforma del host (solo muestra versiones instalables).
/// Resultado ordenado de más reciente a más antiguo.
#[tauri::command]
pub async fn list_available_versions(
    channel: Option<String>,
) -> Result<Vec<AvailableVersion>, String> {
    let channel  = channel.as_deref().unwrap_or("stable");
    let current  = env!("CARGO_PKG_VERSION");
    let platform = host_platform_key();
    let url      = github_api_releases_url();

    let client = reqwest::Client::builder()
        .user_agent(format!("vrc-studio/{}", current))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .send().await
        .map_err(|e| format!("network: {e}"))?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(vec![]);
    }

    if !response.status().is_success() {
        return Err(format!("server error: HTTP {}", response.status()));
    }

    let body = response.text().await.map_err(|e| format!("read: {e}"))?;
    let releases: Vec<GhRelease> = serde_json::from_str(&body)
        .map_err(|e| format!("parse: {e} — body was: {}", &body[..body.len().min(200)]))?;

    // ── Private beta channel ─────────────────────────────────────────────
    if is_beta_channel(channel) {
        let slug = channel;
        let mut versions: Vec<AvailableVersion> = releases
            .into_iter()
            .filter_map(|r| {
                let build = beta_build_number(&r.tag_name, slug)?;
                let asset = r.assets.iter()
                    .find(|a| asset_matches_platform(&a.name, platform))?;
                Some(AvailableVersion {
                    is_current:    false,
                    channel:       slug.to_string(),
                    pub_date:      r.published_at,
                    notes:         r.body.unwrap_or_default(),
                    download_url:  asset.browser_download_url.clone(),
                    download_size: asset.size,
                    version:       build.to_string(),
                })
            })
            .collect();
        versions.sort_by(|a, b| {
            b.version.parse::<u64>().unwrap_or(0)
                .cmp(&a.version.parse::<u64>().unwrap_or(0))
        });
        return Ok(versions);
    }

    // ── Stable / Testing ─────────────────────────────────────────────────
    let mut versions: Vec<AvailableVersion> = releases
        .into_iter()
        .filter(|r| !is_private_beta_tag(&r.tag_name)) // never leak beta tags here
        .filter(|r| channel_from_tag(&r.tag_name, r.prerelease) == channel)
        .filter_map(|r| {
            let asset = r.assets.iter()
                .find(|a| asset_matches_platform(&a.name, platform))?;

            let version = r.tag_name
                .trim_start_matches('v')
                .trim_end_matches("-testing")
                .trim_end_matches("-beta")
                .trim_end_matches("-alpha")
                .to_string();

            Some(AvailableVersion {
                is_current:    version == current,
                channel:       channel_from_tag(&r.tag_name, r.prerelease).to_string(),
                pub_date:      r.published_at,
                notes:         r.body.unwrap_or_default(),
                download_url:  asset.browser_download_url.clone(),
                download_size: asset.size,
                version,
            })
        })
        .collect();

    // Más reciente primero (pub_date es ISO 8601 — orden lexicográfico funciona)
    versions.sort_by(|a, b| b.pub_date.cmp(&a.pub_date));
    Ok(versions)
}

// ──────────────────────────────────────────────────────────────────────────────
//  Beta private channels
// ──────────────────────────────────────────────────────────────────────────────

const BETA_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/s7lver2/vrc-studio/main/beta-registry.json";

#[derive(Debug, Deserialize)]
struct BetaRegistryEntry {
    slug:        String,
    name:        String,
    #[serde(default)]
    description: String,
}

#[derive(Debug, Deserialize)]
struct BetaRegistry {
    codes: HashMap<String, BetaRegistryEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BetaSubscription {
    pub slug:          String,
    pub name:          String,
    pub description:   String,
    pub code:          String,
    pub subscribed_at: String,
}

/// Validates a beta code against the remote registry and stores the subscription.
#[tauri::command]
pub async fn redeem_beta_code(
    code: String,
    pool: State<'_, DbPool>,
) -> Result<BetaSubscription, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("vrc-studio/{}", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let body = client
        .get(BETA_REGISTRY_URL)
        .send().await
        .map_err(|e| format!("network: {e}"))?
        .text().await
        .map_err(|e| format!("read: {e}"))?;

    let registry: BetaRegistry = serde_json::from_str(&body)
        .map_err(|e| format!("parse beta registry: {e}"))?;

    let upper = code.trim().to_uppercase();
    let entry = registry.codes.get(&upper)
        .ok_or_else(|| "Código de beta no válido".to_string())?;

    let sub = BetaSubscription {
        slug:          entry.slug.clone(),
        name:          entry.name.clone(),
        description:   entry.description.clone(),
        code:          upper,
        subscribed_at: chrono::Utc::now().to_rfc3339(),
    };

    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO beta_subscriptions (slug, name, description, code, subscribed_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![sub.slug, sub.name, sub.description, sub.code, sub.subscribed_at],
    ).map_err(|e| e.to_string())?;

    Ok(sub)
}

/// Returns all subscribed beta channels.
#[tauri::command]
pub fn list_beta_subscriptions(pool: State<'_, DbPool>) -> Result<Vec<BetaSubscription>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT slug, name, description, code, subscribed_at FROM beta_subscriptions ORDER BY subscribed_at DESC"
    ).map_err(|e| e.to_string())?;

    let subs = stmt.query_map([], |row| {
        Ok(BetaSubscription {
            slug:          row.get(0)?,
            name:          row.get(1)?,
            description:   row.get(2)?,
            code:          row.get(3)?,
            subscribed_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(subs)
}

/// Removes a beta subscription by slug.
#[tauri::command]
pub fn remove_beta_subscription(slug: String, pool: State<'_, DbPool>) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM beta_subscriptions WHERE slug = ?1",
        rusqlite::params![slug],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
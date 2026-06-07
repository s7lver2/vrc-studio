//! Discord Application Asset uploader.
//!
//! Discord RPC only accepts registered asset keys or public https:// URLs for
//! large/small images.  Local file paths silently fall back to nothing.
//!
//! This service uploads a project cover image to the Discord Application Asset
//! store (POST /api/v10/oauth2/applications/{id}/assets) so it can be used as
//! an asset key in Rich Presence.  Assets are keyed by a sha256 hash of the
//! image bytes so each unique image is only uploaded once.
//!
//! The in-memory cache maps sha256 hex → Discord asset name (which we set equal
//! to the hash).  Discord limits apps to 300 assets; we never delete them.

use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use serde::Deserialize;

const ASSETS_URL: &str = concat!(
    "https://discord.com/api/v10/oauth2/applications/",
    "1510381566503813280",          // CLIENT_ID — kept in sync with discord_auth.rs
    "/assets"
);

// Bot token for application asset management (not user auth).
// It is used ONLY to upload cover images to the app's own asset store.
//
// ⚠️  NEVER hardcode the token here.
// Set the VRCSTUDIO_DISCORD_BOT_TOKEN environment variable at build time,
// or store it in a secrets manager / CI environment.
//
// In development: create a .env file (gitignored) and set:
//   VRCSTUDIO_DISCORD_BOT_TOKEN=your_token_here
// Then run:  cargo build  (the option_env! macro reads it at compile time)
//
// In GitHub Actions:
//   Set VRCSTUDIO_DISCORD_BOT_TOKEN in Settings → Secrets → Actions.
const BOT_TOKEN: &str = match option_env!("VRCSTUDIO_DISCORD_BOT_TOKEN") {
    Some(t) => t,
    None    => "",
};

/// In-memory cache: image sha256 hex → Discord asset name (== the hash).
pub struct DiscordAssetCache {
    pub map: Mutex<HashMap<String, String>>,
}

impl Default for DiscordAssetCache {
    fn default() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct AssetResponse {
    id: String,
    name: String,
}

/// Returns the bot token if configured, or an error.
async fn fetch_app_token() -> Result<String, String> {
    if BOT_TOKEN.is_empty() {
        return Err("Discord Bot token not configured — cannot upload cover assets".to_string());
    }
    Ok(BOT_TOKEN.to_string())
}

/// List existing application assets and return name→id map.
async fn list_assets(token: &str) -> Result<HashMap<String, String>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(ASSETS_URL)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("list assets: {e}"))?;

    if !resp.status().is_success() {
        return Ok(HashMap::new());
    }

    let assets: Vec<AssetResponse> = resp.json().await.unwrap_or_default();
    Ok(assets.into_iter().map(|a| (a.name, a.id)).collect())
}

/// Upload a PNG/JPEG image as an application asset named `hash`.
/// Returns the asset name on success (== `hash`).
async fn upload_asset(token: &str, hash: &str, image_bytes: &[u8]) -> Result<String, String> {
    // Detect image type
    let (mime, data_uri_prefix) = if image_bytes.starts_with(b"\x89PNG") {
        ("image/png", "data:image/png;base64,")
    } else {
        ("image/jpeg", "data:image/jpeg;base64,")
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(image_bytes);
    let data_uri = format!("{}{}", data_uri_prefix, b64);

    let body = serde_json::json!({
        "name": hash,
        "type": 1,           // 1 = rich presence asset
        "image": data_uri,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(ASSETS_URL)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("upload asset: {e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("upload error: {text}"));
    }

    let asset: AssetResponse = resp
        .json()
        .await
        .map_err(|e| format!("upload parse: {e}"))?;
    Ok(asset.name)
}

/// Given a local image path, return the Discord asset key to use in RPC.
/// Returns `None` if the file can't be read or the upload fails (caller falls
/// back to the default "vrcstudio" logo).
pub async fn ensure_discord_asset(
    cache: &DiscordAssetCache,
    image_path: &str,
) -> Option<String> {
    // Read file
    let bytes = tokio::fs::read(image_path).await.ok()?;

    // Hash
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());
    // Use first 24 chars so it stays within Discord's 32-char name limit
    let short_hash = &hash[..24];

    // Check in-memory cache
    {
        let map = cache.map.lock().ok()?;
        if let Some(key) = map.get(short_hash) {
            return Some(key.clone());
        }
    }

    // Need a token
    let token = match fetch_app_token().await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("[discord-assets] token fetch failed: {e}");
            return None;
        }
    };

    // Check if already uploaded (across restarts)
    let existing = list_assets(&token).await.unwrap_or_default();
    if existing.contains_key(short_hash) {
        let mut map = cache.map.lock().ok()?;
        map.insert(short_hash.to_string(), short_hash.to_string());
        return Some(short_hash.to_string());
    }

    // Upload
    match upload_asset(&token, short_hash, &bytes).await {
        Ok(name) => {
            let mut map = cache.map.lock().ok()?;
            map.insert(short_hash.to_string(), name.clone());
            Some(name)
        }
        Err(e) => {
            tracing::warn!("[discord-assets] upload failed: {e}");
            None
        }
    }
}
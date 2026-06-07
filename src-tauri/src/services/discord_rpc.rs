//! Discord Rich Presence service.
//! Manages a persistent IPC connection to the Discord client.
//! The Application ID is a compile-time constant in discord_auth.rs.

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct DiscordRpcState {
    pub client: Mutex<Option<DiscordIpcClient>>,
    pub enabled: Mutex<bool>,
}

impl Default for DiscordRpcState {
    fn default() -> Self {
        Self {
            client: Mutex::new(None),
            enabled: Mutex::new(false),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordActivity {
    pub project_name: Option<String>,
    pub project_cover_image: Option<String>,
    /// Secondary status line (e.g. "Unity open" / "Unity closed" / "VRC Studio")
    pub section: String,
    /// Primary detail line (e.g. project name or section label like "Browsing the Shop")
    pub details: Option<String>,
    pub github_url: Option<String>,
    pub unity_open: bool,
    pub session_start_ts: u64,
    /// Discord asset key or https:// URL for the large image
    pub large_image_key: Option<String>,
    /// Tooltip text for the large image
    pub large_image_text: Option<String>,
}

fn connect_client() -> Result<DiscordIpcClient, String> {
    let mut client = DiscordIpcClient::new(crate::services::discord_auth::CLIENT_ID);
    client
        .connect()
        .map_err(|e| format!("Discord IPC connect: {e}"))?;
    Ok(client)
}

fn update_activity_inner(state: &DiscordRpcState, act: &DiscordActivity) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|e| e.to_string())?;

    if guard.is_none() {
        match connect_client() {
            Ok(c) => *guard = Some(c),
            Err(e) => return Err(e),
        }
    }

    let client = guard.as_mut().unwrap();

    let state_str = act.section.as_str();

    // details: primary line — project name or section label
    let details_str = act
        .details
        .as_deref()
        .or(act.project_name.as_deref())
        .unwrap_or("VRC Studio");

    let timestamps = activity::Timestamps::new().start(act.session_start_ts as i64);

    // large image: explicit key wins, then project cover (https only), then default logo
    let large_image = act
        .large_image_key
        .as_deref()
        .unwrap_or("vrcstudio");
    let large_text = act
        .large_image_text
        .as_deref()
        .or(act.project_name.as_deref())
        .unwrap_or("VRC Studio");

    let mut assets_builder = activity::Assets::new()
        .large_image(large_image)
        .large_text(large_text);

    // Only show small Unity icon when inside a project workspace
    if act.project_name.is_some() {
        assets_builder = assets_builder
            .small_image(if act.unity_open { "unity_open" } else { "unity_closed" })
            .small_text(if act.unity_open { "Unity open" } else { "Unity closed" });
    }

    let assets = assets_builder;

    let mut buttons: Vec<activity::Button> = Vec::new();
    if let Some(ref url) = act.github_url {
        buttons.push(activity::Button::new("View on GitHub", url.as_str()));
    }

    let mut builder = activity::Activity::new()
        .state(state_str)
        .details(details_str)
        .timestamps(timestamps)
        .assets(assets);

    if !buttons.is_empty() {
        builder = builder.buttons(buttons);
    }

    let result = client
        .set_activity(builder)
        .map_err(|e| format!("Discord set_activity: {e}"));

    if result.is_err() {
        // Drop the broken client so the next call triggers a fresh reconnect.
        *guard = None;
    }

    result
}

fn clear_activity_inner(state: &DiscordRpcState) -> Result<(), String> {
    let mut guard = state.client.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut client) = *guard {
        let _ = client.clear_activity();
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn discord_rpc_update(
    state: tauri::State<'_, DiscordRpcState>,
    activity: DiscordActivity,
) -> Result<(), String> {
    // NOTE: The frontend is responsible for gating calls when RPC is disabled
    // (useDiscordRpc returns early and calls discord_rpc_clear instead).
    // We intentionally do NOT check `enabled` here — doing so caused a startup
    // race where the initial update arrived before discord_rpc_set_enabled(true)
    // and was silently dropped, leaving the presence blank until the next navigation.
    update_activity_inner(&state, &activity)
}

#[tauri::command]
pub fn discord_rpc_clear(state: tauri::State<'_, DiscordRpcState>) -> Result<(), String> {
    clear_activity_inner(&state)
}

#[tauri::command]
pub fn discord_rpc_set_enabled(
    state: tauri::State<'_, DiscordRpcState>,
    enabled: bool,
) -> Result<(), String> {
    *state.enabled.lock().map_err(|e| e.to_string())? = enabled;
    if !enabled {
        clear_activity_inner(&state)?;
    }
    Ok(())
}

/// Like `discord_rpc_update` but resolves a local `cover_image_path` to a
/// Discord application asset key first.  Falls back to "vrcstudio" if the
/// upload fails or no path is provided.
#[tauri::command]
pub async fn discord_rpc_update_with_cover(
    state: tauri::State<'_, DiscordRpcState>,
    asset_cache: tauri::State<'_, crate::services::discord_assets::DiscordAssetCache>,
    mut activity: DiscordActivity,
) -> Result<(), String> {
    // If there is a local cover image path, try to upload/resolve it to an asset key
    if let Some(ref path) = activity.project_cover_image.clone() {
        if !path.starts_with("http") {
            // Local path — try to upload
            match crate::services::discord_assets::ensure_discord_asset(&asset_cache, path).await {
                Some(key) => {
                    activity.large_image_key = Some(key);
                }
                None => {
                    // Upload failed, use default logo
                    activity.large_image_key = Some("vrcstudio".to_string());
                }
            }
        }
    }
    update_activity_inner(&state, &activity)
}
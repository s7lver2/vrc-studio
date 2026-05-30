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
    pub section: String,
    pub github_url: Option<String>,
    pub unity_open: bool,
    pub session_start_ts: u64,
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

    let state_str = if act.unity_open {
        "Unity abierto"
    } else {
        "Unity cerrado"
    };

    let details = act
        .project_name
        .as_deref()
        .unwrap_or("Sin proyecto abierto");

    let timestamps = activity::Timestamps::new().start(act.session_start_ts as i64);

    let assets = activity::Assets::new()
        .large_image("vrcstudio")
        .large_text("VRC Studio")
        .small_image(if act.unity_open { "unity_open" } else { "unity_closed" })
        .small_text(if act.unity_open { "Unity abierto" } else { "Unity cerrado" });

    let mut buttons: Vec<activity::Button> = Vec::new();
    if let Some(ref url) = act.github_url {
        buttons.push(activity::Button::new("Ver en GitHub", url.as_str()));
    }

    let mut builder = activity::Activity::new()
        .state(state_str)
        .details(details)
        .timestamps(timestamps)
        .assets(assets);

    if !buttons.is_empty() {
        builder = builder.buttons(buttons);
    }

    client
        .set_activity(builder)
        .map_err(|e| format!("Discord set_activity: {e}"))?;

    Ok(())
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
    let enabled = *state.enabled.lock().map_err(|e| e.to_string())?;
    if !enabled {
        return Ok(());
    }
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

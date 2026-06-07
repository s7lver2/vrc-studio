// src-tauri/src/services/discord_auth.rs
//! Discord Local RPC OAuth — raw IPC protocol for authorization + user identity.
//! The discord-rich-presence crate does not expose AUTHORIZE/AUTHENTICATE,
//! so we implement the wire protocol here directly.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::time::Duration;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

// ── Constants ────────────────────────────────────────────────────────────────
/// Discord Application ID — registered once in the Discord Developer Portal.
/// All users of VRC Studio share this single app identity.
pub const CLIENT_ID: &str = "1510381566503813280";
const CLIENT_SECRET: &str = "RWX2Hjf2nE4l3yc35inl6KWZNG-Y6d49";

// ── State ────────────────────────────────────────────────────────────────────
pub struct DiscordAuthState {
    pub access_token: std::sync::Mutex<Option<String>>,
}

impl Default for DiscordAuthState {
    fn default() -> Self {
        Self {
            access_token: std::sync::Mutex::new(None),
        }
    }
}

// ── Returned to frontend ─────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordUserInfo {
    pub username: String,
    pub discriminator: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordAuthResult {
    pub user: DiscordUserInfo,
    pub access_token: String,
}

// ── IPC helpers ──────────────────────────────────────────────────────────────
fn open_pipe() -> Result<File, String> {
    for i in 0..10 {
        let path = format!("\\\\.\\pipe\\discord-ipc-{}", i);
        if let Ok(f) = OpenOptions::new().read(true).write(true).open(&path) {
            return Ok(f);
        }
    }
    Err("Discord no está abierto. Ábrelo e inténtalo de nuevo.".to_string())
}

fn write_frame(pipe: &mut File, opcode: u32, payload: &str) -> Result<(), String> {
    let bytes = payload.as_bytes();
    let mut buf = Vec::with_capacity(8 + bytes.len());
    buf.extend_from_slice(&opcode.to_le_bytes());
    buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buf.extend_from_slice(bytes);
    pipe.write_all(&buf).map_err(|e| e.to_string())
}

fn read_bytes_exact(pipe: &mut File, buf: &mut [u8]) -> Result<(), String> {
    let mut pos = 0;
    while pos < buf.len() {
        let n = pipe.read(&mut buf[pos..]).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Discord closed the IPC connection (invalid client_id, or Discord restarted).".to_string());
        }
        pos += n;
    }
    Ok(())
}

fn read_frame(pipe: &mut File) -> Result<Value, String> {
    let mut header = [0u8; 8];
    read_bytes_exact(pipe, &mut header)?;
    let length = u32::from_le_bytes([header[4], header[5], header[6], header[7]]) as usize;
    let mut payload = vec![0u8; length];
    read_bytes_exact(pipe, &mut payload)?;
    serde_json::from_slice(&payload).map_err(|e| e.to_string())
}

fn ipc_handshake(pipe: &mut File) -> Result<(), String> {
    let payload = json!({"v": 1, "client_id": CLIENT_ID}).to_string();
    write_frame(pipe, 0, &payload)?;
    let response = read_frame(pipe)?;
    if response["evt"].as_str() == Some("ERROR") {
        return Err(format!(
            "Discord rechazó el handshake: {}",
            response["data"]["message"].as_str().unwrap_or("error desconocido")
        ));
    }
    Ok(())
}

/// Fetch the authenticated user's profile from Discord's REST API.
/// Requires only the `identify` scope — no privileged `rpc` scope needed.
/// Replaces the IPC AUTHENTICATE command which requires `rpc` scope approval.
async fn fetch_user_info(access_token: &str) -> Result<DiscordUserInfo, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://discord.com/api/v10/users/@me")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Error de red al obtener usuario: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Discord API error {status}: {body}"));
    }

    let user: Value = resp
        .json()
        .await
        .map_err(|e| format!("Respuesta invalida de Discord: {e}"))?;

    let avatar_url = match (user["id"].as_str(), user["avatar"].as_str()) {
        (Some(uid), Some(hash)) => Some(format!(
            "https://cdn.discordapp.com/avatars/{uid}/{hash}.png?size=128"
        )),
        _ => None,
    };

    Ok(DiscordUserInfo {
        username: user["username"].as_str().unwrap_or("").to_string(),
        discriminator: user["discriminator"].as_str().unwrap_or("0").to_string(),
        avatar_url,
    })
}

// ── HTTP token exchange ───────────────────────────────────────────────────────
/// redirect_uri registrado en Discord Developer Portal → OAuth2 → Redirects.
/// Debe ser exactamente "http://localhost" (sin puerto, sin trailing slash).
const REDIRECT_URI: &str = "http://localhost";

async fn exchange_token(auth_code: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", auth_code),
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("redirect_uri", REDIRECT_URI),
    ];
    let resp = client
        .post("https://discord.com/api/v10/oauth2/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Error de red en intercambio de token: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Discord API error {status}: {body}"));
    }

    let json: Value = resp
        .json()
        .await
        .map_err(|e| format!("Respuesta inválida de Discord: {e}"))?;

    json["access_token"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No se recibió access_token de Discord.".to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn discord_authorize(
    state: tauri::State<'_, DiscordAuthState>,
) -> Result<DiscordAuthResult, String> {
    // Guard: reject immediately if the app hasn't been configured yet
    if CLIENT_ID == "YOUR_APP_ID_HERE" || CLIENT_ID.is_empty() {
        return Err(
            "Discord app not configured. Set CLIENT_ID in discord_auth.rs before using this feature.".to_string()
        );
    }

    // Phase 1 — AUTHORIZE (blocking IPC, runs in thread pool, 120 s timeout)
    let auth_code = tokio::time::timeout(
        Duration::from_secs(120),
        tokio::task::spawn_blocking(|| -> Result<String, String> {
            let mut pipe = open_pipe()?;
            ipc_handshake(&mut pipe)?;

            let nonce = Uuid::new_v4().to_string();
            let payload = json!({
                "cmd": "AUTHORIZE",
                "args": {
                    "client_id": CLIENT_ID,
                    "scopes": ["identify"],
                    "redirect_uri": REDIRECT_URI
                },
                "nonce": nonce
            })
            .to_string();
            write_frame(&mut pipe, 1, &payload)?;

            // Discord may send intermediate DISPATCH frames before the AUTHORIZE response.
            // Loop until we receive the frame whose cmd is "AUTHORIZE".
            loop {
                let response = read_frame(&mut pipe)?;
                match response["cmd"].as_str() {
                    Some("AUTHORIZE") => {
                        if response["evt"].as_str() == Some("ERROR") {
                            let msg = response["data"]["message"]
                                .as_str()
                                .unwrap_or("denied");
                            return Err(format!("Discord authorization denied: {msg}"));
                        }
                        return response["data"]["code"]
                            .as_str()
                            .map(|s| s.to_string())
                            .ok_or_else(|| format!("Unexpected Discord response: {response}"));
                    }
                    // Any other cmd (e.g. DISPATCH events) → ignore and keep reading
                    _ => continue,
                }
            }
        }),
    )
    .await
    .map_err(|_| "Tiempo de espera agotado (120 s). Acepta el popup en Discord.".to_string())?
    .map_err(|e| e.to_string())?
    ?;

    // Phase 2 — HTTP token exchange (async)
    let access_token = exchange_token(&auth_code).await?;

    // Phase 3 — REST API to get user info (no rpc scope needed)
    let user = fetch_user_info(&access_token).await?;

    // Persist token in backend state
    *state
        .access_token
        .lock()
        .map_err(|e| e.to_string())? = Some(access_token.clone());

    Ok(DiscordAuthResult { user, access_token })
}

#[tauri::command]
pub async fn discord_reauthenticate(
    state: tauri::State<'_, DiscordAuthState>,
    access_token: String,
) -> Result<DiscordUserInfo, String> {
    let user = fetch_user_info(&access_token).await?;

    *state
        .access_token
        .lock()
        .map_err(|e| e.to_string())? = Some(access_token);

    Ok(user)
}

#[tauri::command]
pub fn discord_logout(state: tauri::State<'_, DiscordAuthState>) -> Result<(), String> {
    *state
        .access_token
        .lock()
        .map_err(|e| e.to_string())? = None;
    Ok(())
}
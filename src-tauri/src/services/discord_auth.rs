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
pub const CLIENT_ID: &str = "YOUR_APP_ID_HERE";
const CLIENT_SECRET: &str = "YOUR_CLIENT_SECRET_HERE";
/// Must match one of the Redirect URIs registered in the portal.
const REDIRECT_URI: &str = "http://127.0.0.1";

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
            return Err("Conexión IPC de Discord cerrada inesperadamente.".to_string());
        }
        pos += n;
    }
    Ok(())
}

fn read_frame(pipe: &mut File) -> Result<Value, String> {
    let mut header = [0u8; 8];
    read_bytes_exact(pipe, &mut header)?;
    let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
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

fn ipc_authenticate_with_token(pipe: &mut File, access_token: &str) -> Result<DiscordUserInfo, String> {
    let nonce = Uuid::new_v4().to_string();
    let payload = json!({
        "cmd": "AUTHENTICATE",
        "args": { "access_token": access_token },
        "nonce": nonce
    })
    .to_string();
    write_frame(pipe, 1, &payload)?;
    let response = read_frame(pipe)?;
    if response["evt"].as_str() == Some("ERROR") {
        return Err(format!(
            "Token de Discord inválido o expirado: {}",
            response["data"]["message"].as_str().unwrap_or("error desconocido")
        ));
    }
    let user = &response["data"]["user"];
    let user_id = user["id"].as_str().unwrap_or("").to_string();
    let avatar_hash = user["avatar"].as_str().map(|s| s.to_string());
    Ok(DiscordUserInfo {
        username: user["username"].as_str().unwrap_or("").to_string(),
        discriminator: user["discriminator"].as_str().unwrap_or("0").to_string(),
        avatar_url: avatar_hash.map(|h| {
            format!(
                "https://cdn.discordapp.com/avatars/{}/{}.png?size=128",
                user_id, h
            )
        }),
    })
}

// ── HTTP token exchange ───────────────────────────────────────────────────────
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
                    "scopes": ["rpc", "identify"],
                    "rpc_token": null
                },
                "nonce": nonce
            })
            .to_string();
            write_frame(&mut pipe, 1, &payload)?;

            // Blocks until the user clicks Authorize (or Deny) in Discord
            let response = read_frame(&mut pipe)?;

            if response["evt"].as_str() == Some("ERROR") {
                return Err("Autorización denegada por el usuario.".to_string());
            }
            response["data"]["code"]
                .as_str()
                .map(|s| s.to_string())
                .ok_or_else(|| format!("Respuesta inesperada de Discord: {response}"))
        }),
    )
    .await
    .map_err(|_| "Tiempo de espera agotado (120 s). Acepta el popup en Discord.".to_string())?
    .map_err(|e| e.to_string())?
    .map_err(|e| e)?;

    // Phase 2 — HTTP token exchange (async)
    let access_token = exchange_token(&auth_code).await?;

    // Phase 3 — AUTHENTICATE to get user info (blocking, new pipe connection)
    let token_clone = access_token.clone();
    let user = tokio::task::spawn_blocking(move || -> Result<DiscordUserInfo, String> {
        let mut pipe = open_pipe()?;
        ipc_handshake(&mut pipe)?;
        ipc_authenticate_with_token(&mut pipe, &token_clone)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e)?;

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
    let token_clone = access_token.clone();
    let user = tokio::task::spawn_blocking(move || -> Result<DiscordUserInfo, String> {
        let mut pipe = open_pipe()?;
        ipc_handshake(&mut pipe)?;
        ipc_authenticate_with_token(&mut pipe, &token_clone)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e)?;

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

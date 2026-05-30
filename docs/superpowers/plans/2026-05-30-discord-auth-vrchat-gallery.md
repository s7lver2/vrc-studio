# Discord Local RPC Auth + VRChat Gallery Carousel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual Discord App ID input with a native Discord OAuth popup flow (showing the user's profile after auth), and add a VRChat Gallery splash screen mode that uses the user's VRChat screenshots with explicit privacy consent.

**Architecture:** Two independent features. Discord auth uses a new `discord_auth.rs` module that implements the Discord IPC protocol manually (handshake → AUTHORIZE popup → HTTP token exchange → AUTHENTICATE). VRChat gallery is a new `"vrchat_gallery"` loading screen mode backed by `vrchat_photos.rs` that scans the user's local VRChat screenshots folder.

**Tech Stack:** Rust (tokio async, reqwest, std::fs), Tauri 2 commands, React/TypeScript, Zustand, lucide-react.

---

## File Map

**Created:**
- `src-tauri/src/services/discord_auth.rs` — IPC protocol, AUTHORIZE, AUTHENTICATE, token exchange
- `src-tauri/src/services/vrchat_photos.rs` — detect + scan VRChat photo folder
- `src/components/settings/VRChatGalleryPermissionModal.tsx` — privacy consent modal
- `src/hooks/useVRChatPhotos.ts` — async hook that fetches photo paths from backend
- `src/components/SplashScreenVRChatGallery.tsx` — thin wrapper: loads photos → renders SplashScreenCarousel

**Modified:**
- `src-tauri/src/services/discord_rpc.rs` — use compile-time CLIENT_ID, remove app_id field + configure command
- `src-tauri/src/services/mod.rs` — declare discord_auth + vrchat_photos modules
- `src-tauri/src/lib.rs` — register new commands, manage DiscordAuthState
- `src-tauri/Cargo.toml` — add `rand = "0.8"`
- `src/lib/tauri.ts` — add Discord auth + VRChat scan functions, remove tauriDiscordRpcConfigure
- `src/store/app.ts` — add discordUser + discordAccessToken; remove discordAppId
- `src/components/settings/ConnectionsHub.tsx` — replace DiscordRpcSection with DiscordConnectionCard
- `src/components/SplashScreenCarousel.tsx` — add optional overrideImages prop
- `src/store/appearanceStore.ts` — add "vrchat_gallery" mode + vrchatGalleryPath field
- `src/components/settings/AppearanceSection.tsx` — third loading screen button + revocation row
- `src/App.tsx` — silent Discord reauth on mount + route vrchat_gallery mode

---

## Task 1: discord_auth.rs — IPC protocol + all three commands

**Files:**
- Create: `src-tauri/src/services/discord_auth.rs`

This module implements the raw Discord IPC protocol over Windows named pipes.
The pipe speaks a simple binary framing: `[opcode: u32 LE][length: u32 LE][json payload]`.
Opcodes: 0 = Handshake, 1 = Frame (commands/events), 2 = Close.

**Important:** Replace `"YOUR_APP_ID_HERE"` and `"YOUR_CLIENT_SECRET_HERE"` with real values from https://discord.com/developers/applications before building. The redirect URI `http://127.0.0.1` must be registered in the portal under OAuth2 → Redirects.

- [ ] **Step 1: Create the file with the complete implementation**

```rust
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
    // Expect READY event; opcode 1 means Frame, which is correct
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

/// Full authorization flow:
/// 1. Open pipe + handshake
/// 2. Send AUTHORIZE → Discord shows native popup to the user
/// 3. Exchange auth_code for access_token via HTTP
/// 4. Open new pipe + handshake + AUTHENTICATE → get user info
///
/// Times out after 120 seconds waiting for the user to click in Discord.
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

/// Silent re-authentication using a previously saved access token.
/// Called at app start if a token is found in localStorage.
/// Returns Err if the token is expired or Discord is not running.
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

/// Clears the in-memory access token. Frontend handles clearing localStorage.
#[tauri::command]
pub fn discord_logout(state: tauri::State<'_, DiscordAuthState>) -> Result<(), String> {
    *state
        .access_token
        .lock()
        .map_err(|e| e.to_string())? = None;
    Ok(())
}
```

- [ ] **Step 2: Verify the file compiles (run after registering in mod.rs and lib.rs in Task 3)**

```
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: no errors related to discord_auth.rs (there will be errors about missing module declarations until Task 3 is done).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/discord_auth.rs
git commit -m "feat(discord): add discord_auth.rs — local RPC OAuth IPC protocol"
```

---

## Task 2: Update discord_rpc.rs — use compile-time CLIENT_ID, remove app_id field

**Files:**
- Modify: `src-tauri/src/services/discord_rpc.rs`

The `DiscordRpcState` currently has an `app_id: Mutex<String>` field that was introduced to support runtime App ID configuration (now replaced by the compile-time constant). The `discord_rpc_configure` command is also removed.

- [ ] **Step 1: Replace the full file content**

```rust
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
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/services/discord_rpc.rs
git commit -m "refactor(discord-rpc): use compile-time CLIENT_ID, remove app_id field"
```

---

## Task 3: Register modules and commands in mod.rs + lib.rs

**Files:**
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `discord_auth` to `services/mod.rs`**

Add after the existing `pub mod discord_rpc;` line:

```rust
pub mod discord_auth;
```

The full file after this change:
```
pub mod unity_detector;
pub mod vpm_client;
pub mod dependency_resolver;
pub mod project_creator;
pub mod vpm;
pub mod package_builder;
pub mod auth_store;
pub mod booth;
pub mod downloader;
pub mod booth_webview;
pub mod git_service;
pub mod github_oauth;
pub mod tracker_service;
pub mod prefab_parser;
pub mod tray;
pub mod vcc_reader;
pub mod discord_rpc;
pub mod discord_auth;
```

- [ ] **Step 2: Update `lib.rs` — manage DiscordAuthState + register 3 new commands + remove 2 old ones**

In `lib.rs`, locate `.manage(crate::services::discord_rpc::DiscordRpcState::default())` and add the auth state below it:

```rust
.manage(crate::services::discord_rpc::DiscordRpcState::default())
.manage(crate::services::discord_auth::DiscordAuthState::default())
```

In the `generate_handler![]` list, remove `crate::services::discord_rpc::discord_rpc_configure` and add the three new commands:

```rust
// ── Discord Rich Presence ──
crate::services::discord_rpc::discord_rpc_update,
crate::services::discord_rpc::discord_rpc_clear,
crate::services::discord_rpc::discord_rpc_set_enabled,
// ── Discord Auth ──
crate::services::discord_auth::discord_authorize,
crate::services::discord_auth::discord_reauthenticate,
crate::services::discord_auth::discord_logout,
```

- [ ] **Step 3: Verify compilation**

```
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: `Finished` with only warnings, no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/mod.rs src-tauri/src/lib.rs
git commit -m "feat(discord): register discord_auth commands and DiscordAuthState"
```

---

## Task 4: Frontend — tauri.ts + app.ts + remove old discord config UI

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/store/app.ts`

- [ ] **Step 1: Update `src/lib/tauri.ts`**

Remove `tauriDiscordRpcConfigure` (added in previous session). Add the three new Discord auth functions and the `DiscordUserInfo` + `DiscordAuthResult` interfaces after the existing `tauriDiscordRpcSetEnabled` function:

```ts
// ── Discord Auth ────────────────────────────────────────────────────────────

export interface DiscordUserInfo {
  username: string;
  discriminator: string;
  avatar_url: string | null;
}

export interface DiscordAuthResult {
  user: DiscordUserInfo;
  access_token: string;
}

/** Full OAuth flow — triggers native Discord popup. Returns user info + token. */
export async function tauriDiscordAuthorize(): Promise<DiscordAuthResult> {
  return invoke<DiscordAuthResult>("discord_authorize");
}

/** Silent re-auth with a saved token. Fails if token expired or Discord not running. */
export async function tauriDiscordReauthenticate(accessToken: string): Promise<DiscordUserInfo> {
  return invoke<DiscordUserInfo>("discord_reauthenticate", { accessToken });
}

/** Clears the in-memory token on the backend side. */
export async function tauriDiscordLogout(): Promise<void> {
  return invoke<void>("discord_logout");
}
```

Also remove the `tauriDiscordRpcConfigure` function block if it exists.

- [ ] **Step 2: Update `src/store/app.ts` — replace discordAppId with discordUser + discordAccessToken**

Replace the current file with:

```ts
import { create } from "zustand";
import type { Project } from "@/lib/tauri";
import type { DiscordUserInfo } from "@/lib/tauri";
import { isGetStartedDone, resetGetStarted } from "@/components/GetStarted";

export type Section = "projects" | "packages" | "shop" | "inventory" | "tracker" | "settings" | "workspace" | "logs" | "creators" | "git";

interface AppState {
  activeSection: Section;
  isLoading: boolean;
  loadingMessage: string | null;
  workspaceProject: Project | null;
  selectedProject: Project | null;
  showGetStarted: boolean;
  showAdultContent: boolean;

  discordRpcEnabled: boolean;
  /** Populated after successful Discord OAuth. Null = not connected. */
  discordUser: DiscordUserInfo | null;
  /** Persisted to localStorage. Used for silent reauth on next launch. */
  discordAccessToken: string | null;

  setDiscordRpcEnabled: (v: boolean) => void;
  setDiscordUser: (u: DiscordUserInfo | null) => void;
  setDiscordAccessToken: (t: string | null) => void;
  setShowAdultContent: (v: boolean) => void;
  setActiveSection: (section: Section) => void;
  setLoading: (loading: boolean, message?: string) => void;
  openWorkspace: (project: Project) => void;
  closeWorkspace: () => void;
  setSelectedProject: (project: Project | null) => void;
  openGetStarted: () => void;
  closeGetStarted: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "projects",
  isLoading: false,
  showAdultContent: false,
  loadingMessage: null,
  workspaceProject: null,
  selectedProject: null,
  showGetStarted: !isGetStartedDone(),

  discordRpcEnabled: (() => {
    try { return localStorage.getItem("discord_rpc_enabled") === "true"; }
    catch { return false; }
  })(),
  discordUser: null, // populated at runtime after reauth/auth
  discordAccessToken: (() => {
    try { return localStorage.getItem("discord_access_token") ?? null; }
    catch { return null; }
  })(),

  setDiscordRpcEnabled: (v) => {
    set({ discordRpcEnabled: v });
    try { localStorage.setItem("discord_rpc_enabled", String(v)); } catch {}
  },
  setDiscordUser: (u) => set({ discordUser: u }),
  setDiscordAccessToken: (t) => {
    set({ discordAccessToken: t });
    try {
      if (t) { localStorage.setItem("discord_access_token", t); }
      else { localStorage.removeItem("discord_access_token"); }
    } catch {}
  },
  setActiveSection: (section) => set({ activeSection: section }),
  setLoading: (loading, message) =>
    set({ isLoading: loading, loadingMessage: loading ? (message ?? null) : null }),
  openWorkspace: (project) => set({ activeSection: "workspace", workspaceProject: project }),
  closeWorkspace: () => set({ activeSection: "projects", workspaceProject: null }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  openGetStarted: () => {
    resetGetStarted();
    set({ showGetStarted: true });
  },
  closeGetStarted: () => set({ showGetStarted: false }),
  setShowAdultContent: (v) => set({ showAdultContent: v }),
}));
```

- [ ] **Step 3: Run tsc to verify no type errors**

```
npx tsc --noEmit
```
Expected: clean (0 errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/tauri.ts src/store/app.ts
git commit -m "feat(discord): add auth types/functions to tauri.ts, update app store"
```

---

## Task 5: ConnectionsHub.tsx — replace DiscordRpcSection with DiscordConnectionCard

**Files:**
- Modify: `src/components/settings/ConnectionsHub.tsx`

Remove the current `DiscordRpcSection` component (the one with the App ID input added in the previous session). Replace it with `DiscordConnectionCard` — a proper card that follows the existing `ConnectionCard` visual pattern and handles the full OAuth flow.

- [ ] **Step 1: Update imports at the top of ConnectionsHub.tsx**

```ts
import React, { useState, useEffect, useCallback } from "react";
import {
  LogOut, ExternalLink, Loader2,
  AlertTriangle, Copy, Check, Wifi, MessageSquare,
} from "lucide-react";
import { useBoothStatus } from "@/hooks/useBoothStatus";
import { github, GithubUserInfo, tauriDiscordAuthorize, tauriDiscordLogout, tauriDiscordRpcSetEnabled } from "@/lib/tauri";
import { useAppearanceStore } from "@/store/appearanceStore";
import { useAppStore } from "@/store/app";
```

- [ ] **Step 2: Replace the entire `DiscordRpcSection` function with `DiscordConnectionCard`**

Delete everything from `function DiscordRpcSection()` to its closing `}`, then add this component before `export function ConnectionHub()`:

```tsx
function DiscordConnectionCard() {
  const discordUser    = useAppStore((s) => s.discordUser);
  const setDiscordUser = useAppStore((s) => s.setDiscordUser);
  const setDiscordAccessToken = useAppStore((s) => s.setDiscordAccessToken);
  const discordRpcEnabled    = useAppStore((s) => s.discordRpcEnabled);
  const setDiscordRpcEnabled = useAppStore((s) => s.setDiscordRpcEnabled);
  const { animSpeed } = useAppearanceStore();

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const isConnected  = discordUser != null;
  const statusColor  = isConnected ? "#34d399" : connecting ? "#a16207" : "#52525b";
  const statusLabel  = isConnected ? "Connected" : connecting ? "Waiting for Discord…" : "Disconnected";

  const accountLine  = isConnected
    ? (discordUser.discriminator === "0" || discordUser.discriminator === ""
        ? `@${discordUser.username}`
        : `@${discordUser.username}#${discordUser.discriminator}`)
    : null;

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await tauriDiscordAuthorize();
      setDiscordUser(result.user);
      setDiscordAccessToken(result.access_token);
      setExpanded(true);
    } catch (e: unknown) {
      setConnectError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [setDiscordUser, setDiscordAccessToken]);

  const handleDisconnect = useCallback(async () => {
    await tauriDiscordLogout().catch(() => {});
    setDiscordUser(null);
    setDiscordAccessToken(null);
    setExpanded(false);
  }, [setDiscordUser, setDiscordAccessToken]);

  const handleToggleRpc = useCallback(async (v: boolean) => {
    setDiscordRpcEnabled(v);
    await tauriDiscordRpcSetEnabled(v).catch(() => {});
  }, [setDiscordRpcEnabled]);

  const discordLogo = (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#5865F2">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
    </svg>
  );

  return (
    <div
      className={cn(
        "relative rounded-2xl border overflow-hidden",
        isConnected ? "border-indigo-800/60" : "border-zinc-800"
      )}
      style={{
        background: isConnected
          ? "radial-gradient(ellipse at 0% 0%, rgba(88,101,242,0.07) 0%, #09090b 60%)"
          : "#0f0f11",
        boxShadow: isConnected
          ? "0 0 0 1px rgba(88,101,242,0.12), 0 4px 24px rgba(88,101,242,0.07)"
          : "none",
        transition: "box-shadow 0.3s ease, border-color 0.3s ease",
      }}
    >
      {/* Main row */}
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Logo with status dot */}
        <div className="relative shrink-0">
          <div
            className={cn(
              "w-11 h-11 rounded-xl flex items-center justify-center bg-zinc-900 border",
              isConnected ? "border-indigo-700/40" : "border-zinc-800"
            )}
          >
            {discordLogo}
          </div>
          <div
            className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-zinc-950"
            style={{ background: statusColor }}
          >
            {isConnected && animSpeed !== "off" && (
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ background: statusColor, opacity: 0.4 }}
              />
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-semibold text-zinc-100">Discord</p>
            <span className="text-[10px] font-medium" style={{ color: statusColor }}>
              {statusLabel}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed truncate">
            Show your current project and session time on your Discord profile.
          </p>
          {accountLine && isConnected && (
            <p className="text-[11px] mt-1 font-mono" style={{ color: "#5865F2" }}>
              {accountLine}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isConnected ? (
            <>
              <button
                onClick={() => setExpanded((e) => !e)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-all"
              >
                {expanded ? "Less" : "Details"}
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 text-[11px] text-zinc-400 hover:text-red-400 hover:border-red-900 transition-all"
              >
                <LogOut className="h-3.5 w-3.5" /> Disconnect
              </button>
            </>
          ) : connecting ? (
            <span className="text-[10px] text-zinc-600 italic flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for Discord…
            </span>
          ) : (
            <button
              onClick={handleConnect}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-semibold text-white transition-all"
              style={{ background: "#5865F2", boxShadow: "0 0 14px rgba(88,101,242,0.3)" }}
            >
              Connect with Discord
            </button>
          )}
        </div>
      </div>

      {/* Waiting hint */}
      {connecting && (
        <div className="border-t border-zinc-800 px-5 py-3">
          <p className="text-[11px] text-zinc-500">
            Discord está mostrando un popup de autorización. Acepta en Discord para continuar.
          </p>
        </div>
      )}

      {/* Error */}
      {!connecting && connectError && (
        <div className="border-t border-zinc-800 px-5 py-3 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-400">{connectError}</p>
        </div>
      )}

      {/* Expanded: avatar + Rich Presence toggle */}
      {expanded && isConnected && (
        <div className="border-t border-zinc-800/60 px-5 py-4 flex flex-col gap-4">
          {/* Profile row */}
          <div className="flex items-center gap-3">
            {discordUser.avatar_url ? (
              <img
                src={discordUser.avatar_url}
                className="w-10 h-10 rounded-full ring-2"
                style={{ boxShadow: "0 0 0 2px rgba(88,101,242,0.4)" }}
                alt=""
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-indigo-900/40 border border-indigo-700/40 flex items-center justify-center">
                <span className="text-sm font-bold text-indigo-300">
                  {discordUser.username[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <p className="text-sm font-bold text-zinc-100">{discordUser.username}</p>
              {accountLine && (
                <p className="text-xs text-zinc-500">{accountLine}</p>
              )}
            </div>
          </div>

          {/* Rich Presence toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-zinc-300">Rich Presence</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                Show your project and session time on your Discord status.
              </p>
            </div>
            <button
              onClick={() => handleToggleRpc(!discordRpcEnabled)}
              className={cn(
                "overflow-hidden w-9 h-5 rounded-full transition-colors relative shrink-0",
                discordRpcEnabled ? "bg-indigo-600" : "bg-zinc-700"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white transition-transform",
                  discordRpcEnabled ? "translate-x-4" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update `ConnectionHub` to render `DiscordConnectionCard` instead of `DiscordRpcSection`**

In the `ConnectionHub` return value, replace `<DiscordRpcSection />` with `<DiscordConnectionCard />`. Also remove `MessageSquare` from the imports since it's no longer used (the card uses the inline SVG instead):

```tsx
return (
  <div className="flex flex-col gap-4">
    <div className="flex items-center gap-2">
      <Wifi className="h-3.5 w-3.5 text-zinc-500" />
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Integrations</p>
    </div>
    <div className="flex flex-col gap-3">
      {cards.map((card) => (
        <ConnectionCard key={card.id} card={card} />
      ))}
      <DiscordConnectionCard />
    </div>
  </div>
);
```

Also remove `MessageSquare` from the lucide-react import line since it's no longer needed.

- [ ] **Step 4: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ConnectionsHub.tsx
git commit -m "feat(discord): replace DiscordRpcSection with OAuth-based DiscordConnectionCard"
```

---

## Task 6: App.tsx — silent Discord reauth on mount

**Files:**
- Modify: `src/App.tsx`

On app start, if a Discord access token is saved in the store (from a previous session), silently re-authenticate to restore the user's profile. If it fails (Discord not running, token expired), clear the token without showing any error.

- [ ] **Step 1: Add imports for Discord auth functions**

Add to the existing imports in `App.tsx`:

```ts
import { tauriDiscordReauthenticate } from "@/lib/tauri";
```

- [ ] **Step 2: Add silent reauth logic in the main `App` component**

Find the `function App()` definition. Add a `useEffect` that runs once on mount, after the existing effects:

```tsx
// Silent Discord reauth — restore profile if token was saved from previous session
const discordAccessToken    = useAppStore((s) => s.discordAccessToken);
const setDiscordUser        = useAppStore((s) => s.setDiscordUser);
const setDiscordAccessToken = useAppStore((s) => s.setDiscordAccessToken);

useEffect(() => {
  if (!discordAccessToken) return;
  tauriDiscordReauthenticate(discordAccessToken)
    .then((user) => setDiscordUser(user))
    .catch(() => {
      // Token expired or Discord not running — clear silently
      setDiscordAccessToken(null);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // run once on mount only
```

- [ ] **Step 3: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(discord): silent reauth on app start using saved access token"
```

---

## Task 7: Backend — vrchat_photos.rs + Cargo.toml

**Files:**
- Create: `src-tauri/src/services/vrchat_photos.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add `rand` to Cargo.toml**

In `src-tauri/Cargo.toml`, add after the `discord-rich-presence` line:

```toml
rand = "0.8"
```

- [ ] **Step 2: Create `vrchat_photos.rs`**

```rust
// src-tauri/src/services/vrchat_photos.rs
//! Commands for discovering and scanning the user's VRChat screenshots folder.

use rand::seq::SliceRandom;
use std::path::PathBuf;

/// Returns the default VRChat screenshots path if it exists:
/// %USERPROFILE%\Pictures\VRChat
#[tauri::command]
pub fn detect_vrchat_photos_folder() -> Option<String> {
    let base = dirs_next_pictures_dir()?;
    let candidate = base.join("VRChat");
    if candidate.is_dir() {
        Some(candidate.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Returns up to `count` randomly selected image paths from `path`.
/// Also grants the asset protocol scope for the folder so the frontend
/// can display images via convertFileSrc / toAssetUrl.
#[tauri::command]
pub fn scan_vrchat_photos(
    app: tauri::AppHandle,
    path: String,
    count: u32,
) -> Result<Vec<String>, String> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("La carpeta no existe: {path}"));
    }

    // Grant asset protocol scope so frontend can load these images
    app.fs_scope()
        .allow_directory(dir, true)
        .map_err(|e| e.to_string())?;

    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    let mut images: Vec<String> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let ext = path
                .extension()?
                .to_str()?
                .to_lowercase();
            if matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
                Some(path.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect();

    if images.is_empty() {
        return Err("No se encontraron imágenes (.jpg, .jpeg, .png) en esa carpeta.".to_string());
    }

    // Shuffle and take up to `count`
    let mut rng = rand::thread_rng();
    images.shuffle(&mut rng);
    images.truncate(count as usize);

    Ok(images)
}

/// Resolves %USERPROFILE%\Pictures using the standard Windows path.
fn dirs_next_pictures_dir() -> Option<PathBuf> {
    // USERPROFILE is always set on Windows
    let home = std::env::var("USERPROFILE").ok()?;
    Some(PathBuf::from(home).join("Pictures"))
}
```

- [ ] **Step 3: Verify compilation**

```
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: compiles (module not yet declared — errors appear in next task).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/services/vrchat_photos.rs
git commit -m "feat(vrchat-gallery): add vrchat_photos backend service"
```

---

## Task 8: Register VRChat commands in mod.rs + lib.rs

**Files:**
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `vrchat_photos` to `services/mod.rs`**

Add at the end of the file:

```rust
pub mod vrchat_photos;
```

- [ ] **Step 2: Register the two new commands in `lib.rs` generate_handler![]**

Add after the Discord Auth commands:

```rust
// ── VRChat Gallery ──
crate::services::vrchat_photos::detect_vrchat_photos_folder,
crate::services::vrchat_photos::scan_vrchat_photos,
```

- [ ] **Step 3: Verify compilation**

```
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: `Finished` with only warnings.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/services/mod.rs src-tauri/src/lib.rs
git commit -m "feat(vrchat-gallery): register VRChat photos commands"
```

---

## Task 9: appearanceStore.ts — add "vrchat_gallery" mode + vrchatGalleryPath

**Files:**
- Modify: `src/store/appearanceStore.ts`

- [ ] **Step 1: Update the `loadingScreen` type and add `vrchatGalleryPath`**

Find line `loadingScreen: "classic" | "carousel";` in the interface and replace with:

```ts
loadingScreen: "classic" | "carousel" | "vrchat_gallery";
vrchatGalleryPath: string | null;
```

Find `setLoadingScreen: (v: "classic" | "carousel") => void;` and replace with:

```ts
setLoadingScreen: (v: "classic" | "carousel" | "vrchat_gallery") => void;
setVrchatGalleryPath: (p: string | null) => void;
```

- [ ] **Step 2: Update the `Omit` list in the `load()` return type signature**

Add `"setVrchatGalleryPath"` to the Omit union (same line as `"setLoadingScreen"`):

```ts
"setBetaFeaturesEnabled" | "setLoadingScreen" | "setCarouselImages" |
"addCarouselImage" | "removeCarouselImage" | "setCustomWallpaper" | "clearCustomWallpaper" |
"setVrchatGalleryPath"
```

- [ ] **Step 3: Add defaults in the `load()` function**

In the `return` inside the `try { const raw = ... }` block, after `carouselImages: parsed.carouselImages ?? []`, add:

```ts
vrchatGalleryPath: (parsed.vrchatGalleryPath as string | null) ?? null,
```

In the fallback `return` (after the `try/catch`), after `carouselImages: []`, add:

```ts
vrchatGalleryPath: null,
```

Also update the `loadingScreen` cast in both returns to include `"vrchat_gallery"`:

```ts
loadingScreen: (parsed.loadingScreen ?? "classic") as "classic" | "carousel" | "vrchat_gallery",
```

and in the fallback:

```ts
loadingScreen: "classic" as const,
```

(The fallback is fine as-is since `"classic"` is a valid value of the updated union.)

- [ ] **Step 4: Add `setVrchatGalleryPath` action to the store**

After `setLoadingScreen: (loadingScreen) => { ... }`, add:

```ts
setVrchatGalleryPath: (vrchatGalleryPath) => {
  set({ vrchatGalleryPath });
  save({ ...get(), vrchatGalleryPath });
},
```

- [ ] **Step 5: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/appearanceStore.ts
git commit -m "feat(vrchat-gallery): add vrchat_gallery mode to appearance store"
```

---

## Task 10: Frontend VRChat functions in tauri.ts

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add VRChat scanning functions after the Discord Auth block**

```ts
// ── VRChat Gallery ────────────────────────────────────────────────────────────

/**
 * Returns the default VRChat screenshots folder path if it exists
 * (%USERPROFILE%\Pictures\VRChat), or null if it doesn't.
 */
export async function tauriDetectVRChatPhotosFolder(): Promise<string | null> {
  return invoke<string | null>("detect_vrchat_photos_folder");
}

/**
 * Scans `path` for .jpg/.jpeg/.png files, grants asset protocol scope for the
 * folder, and returns up to `count` randomly selected absolute file paths.
 * Throws if the folder is empty or doesn't exist.
 */
export async function tauriScanVRChatPhotos(
  path: string,
  count: number
): Promise<string[]> {
  return invoke<string[]>("scan_vrchat_photos", { path, count });
}
```

- [ ] **Step 2: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(vrchat-gallery): add tauriDetectVRChatPhotosFolder + tauriScanVRChatPhotos"
```

---

## Task 11: VRChatGalleryPermissionModal.tsx

**Files:**
- Create: `src/components/settings/VRChatGalleryPermissionModal.tsx`

- [ ] **Step 1: Create the file**

```tsx
/**
 * VRChatGalleryPermissionModal — privacy consent dialog for VRChat Gallery mode.
 *
 * Flow:
 *   1. Show privacy commitment (consent phase)
 *   2. On "Permitir acceso": auto-detect Pictures\VRChat
 *   3a. If found + has images → set path + mode, close
 *   3b. If not found → show manual folder picker
 */
import { useState, useCallback } from "react";
import { Lock, FolderOpen, X, Check } from "lucide-react";
import { open as tauriOpenFolder } from "@tauri-apps/plugin-dialog";
import {
  tauriDetectVRChatPhotosFolder,
  tauriScanVRChatPhotos,
} from "@/lib/tauri";
import { useAppearanceStore } from "@/store/appearanceStore";

interface Props {
  onClose: () => void;
}

type Phase = "consent" | "detecting" | "not-found";

export function VRChatGalleryPermissionModal({ onClose }: Props) {
  const setLoadingScreen    = useAppearanceStore((s) => s.setLoadingScreen);
  const setVrchatGalleryPath = useAppearanceStore((s) => s.setVrchatGalleryPath);

  const [phase, setPhase] = useState<Phase>("consent");
  const [pickError, setPickError] = useState<string | null>(null);

  const handleAllow = useCallback(async () => {
    setPhase("detecting");
    try {
      const detected = await tauriDetectVRChatPhotosFolder();
      if (detected) {
        // Verify there are actual images before activating
        const photos = await tauriScanVRChatPhotos(detected, 1).catch(() => [] as string[]);
        if (photos.length > 0) {
          setVrchatGalleryPath(detected);
          setLoadingScreen("vrchat_gallery");
          onClose();
          return;
        }
      }
    } catch {
      // fall through to manual picker
    }
    setPhase("not-found");
  }, [setLoadingScreen, setVrchatGalleryPath, onClose]);

  const handlePickFolder = useCallback(async () => {
    setPickError(null);
    const result = await tauriOpenFolder({
      directory: true,
      title: "Selecciona tu carpeta de fotos de VRChat",
    });
    if (!result) return; // user cancelled

    const folder = typeof result === "string" ? result : (result as string[])[0];
    if (!folder) return;

    try {
      const photos = await tauriScanVRChatPhotos(folder, 1);
      if (photos.length === 0) {
        setPickError("No se encontraron imágenes (.jpg, .png) en esa carpeta.");
        return;
      }
      setVrchatGalleryPath(folder);
      setLoadingScreen("vrchat_gallery");
      onClose();
    } catch (e: unknown) {
      setPickError(e instanceof Error ? e.message : String(e));
    }
  }, [setLoadingScreen, setVrchatGalleryPath, onClose]);

  const privacyItems = [
    "Tus fotos nunca se publican ni se envían a ningún servidor.",
    "El acceso es únicamente local en tu equipo.",
    "Puedes revocar este permiso en cualquier momento desde los ajustes.",
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-950/60 border border-violet-800/40 flex items-center justify-center">
              <Lock className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Acceso a fotos de VRChat</p>
              <p className="text-[11px] text-zinc-500">Permiso de lectura local</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-5 flex flex-col gap-4">
          <p className="text-xs text-zinc-400 leading-relaxed">
            VRC Studio cargará imágenes de tu carpeta de capturas de VRChat para
            mostrarlas en la pantalla de carga cada vez que abras la app.
          </p>

          {/* Privacy commitment */}
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-zinc-300">Compromiso de privacidad</p>
            <ul className="flex flex-col gap-1.5">
              {privacyItems.map((item) => (
                <li key={item} className="text-[11px] text-zinc-500 flex items-start gap-1.5">
                  <Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Not-found phase: show manual picker */}
          {phase === "not-found" && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-zinc-500">
                No encontramos tu carpeta en{" "}
                <span className="font-mono text-zinc-400">Pictures\VRChat</span>.
                Selecciónala manualmente:
              </p>
              <button
                onClick={handlePickFolder}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors self-start"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Seleccionar carpeta…
              </button>
              {pickError && (
                <p className="text-[11px] text-red-400">{pickError}</p>
              )}
            </div>
          )}

          {/* Consent/detecting phase: Cancel + Allow buttons */}
          {phase !== "not-found" && (
            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAllow}
                disabled={phase === "detecting"}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {phase === "detecting" ? "Buscando…" : "Permitir acceso"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/VRChatGalleryPermissionModal.tsx
git commit -m "feat(vrchat-gallery): add VRChatGalleryPermissionModal with privacy consent"
```

---

## Task 12: useVRChatPhotos hook + SplashScreenCarousel overrideImages + SplashScreenVRChatGallery

**Files:**
- Create: `src/hooks/useVRChatPhotos.ts`
- Modify: `src/components/SplashScreenCarousel.tsx`
- Create: `src/components/SplashScreenVRChatGallery.tsx`

- [ ] **Step 1: Create `src/hooks/useVRChatPhotos.ts`**

```ts
import { useState, useEffect } from "react";
import { tauriScanVRChatPhotos } from "@/lib/tauri";
import type { CarouselImageEntry } from "@/store/appearanceStore";

/**
 * Fetches up to 50 random VRChat screenshot paths from the backend.
 * Returns an empty array while loading or if the path is null/invalid.
 * Each call on mount fetches a new random selection.
 */
export function useVRChatPhotos(path: string | null): CarouselImageEntry[] {
  const [entries, setEntries] = useState<CarouselImageEntry[]>([]);

  useEffect(() => {
    if (!path) {
      setEntries([]);
      return;
    }
    tauriScanVRChatPhotos(path, 50)
      .then((paths) => {
        setEntries(
          paths.map((p, i) => ({
            id: `vrc-${i}`,
            path: p,
            builtInId: null,
          }))
        );
      })
      .catch(() => setEntries([]));
  }, [path]);

  return entries;
}
```

- [ ] **Step 2: Add `overrideImages` prop to `SplashScreenCarousel`**

In `src/components/SplashScreenCarousel.tsx`, update the `Props` interface:

```ts
interface Props {
  onDone: () => void;
  /** When provided, use these images instead of the store's carouselImages. */
  overrideImages?: CarouselImageEntry[];
}
```

Update the function signature:

```ts
export function SplashScreenCarousel({ onDone, overrideImages }: Props) {
```

Update the `imageList` line (currently line 57-59):

```ts
const imageList: CarouselImageEntry[] =
  (overrideImages ?? carouselImages).length > 0
    ? (overrideImages ?? carouselImages)
    : BUILT_IN_SPLASH_IMAGES.map((img) => ({ id: img.id, path: null, builtInId: img.id }));
```

- [ ] **Step 3: Create `src/components/SplashScreenVRChatGallery.tsx`**

```tsx
/**
 * SplashScreenVRChatGallery — loading screen that shows the user's VRChat screenshots.
 * Fetches up to 50 random photos from the backend and renders them via SplashScreenCarousel.
 * Falls back to built-in artwork if the folder is empty or unavailable.
 */
import { useVRChatPhotos } from "@/hooks/useVRChatPhotos";
import { SplashScreenCarousel } from "@/components/SplashScreenCarousel";
import { useAppearanceStore } from "@/store/appearanceStore";

interface Props {
  onDone: () => void;
}

export function SplashScreenVRChatGallery({ onDone }: Props) {
  const vrchatGalleryPath = useAppearanceStore((s) => s.vrchatGalleryPath);
  const photos = useVRChatPhotos(vrchatGalleryPath);

  // If photos haven't loaded yet, overrideImages is [] which causes SplashScreenCarousel
  // to fall back to built-in images — correct behavior.
  return (
    <SplashScreenCarousel
      onDone={onDone}
      overrideImages={photos.length > 0 ? photos : undefined}
    />
  );
}
```

- [ ] **Step 4: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useVRChatPhotos.ts src/components/SplashScreenCarousel.tsx src/components/SplashScreenVRChatGallery.tsx
git commit -m "feat(vrchat-gallery): useVRChatPhotos hook + SplashScreenVRChatGallery component"
```

---

## Task 13: AppearanceSection.tsx — third loading screen option + revocation row

**Files:**
- Modify: `src/components/settings/AppearanceSection.tsx`

- [ ] **Step 1: Add `Camera` to the lucide-react imports**

Update the first import line from:

```ts
import {
    Palette, ImageIcon, Monitor, Type, LayoutGrid,
    Zap, Grid3X3, Upload, Trash2, Plus, FlaskConical,
    Monitor as MonitorIcon
    
} from "lucide-react";
```

To:

```ts
import {
    Palette, ImageIcon, Monitor, Type, LayoutGrid,
    Zap, Grid3X3, Upload, Trash2, Plus, FlaskConical,
    Monitor as MonitorIcon, Camera
} from "lucide-react";
```

- [ ] **Step 2: Import the permission modal and the new store fields**

Add to the existing store import line:

```ts
import {
    useAppearanceStore, THEMES, AppTheme, ThemeId,
    ALL_SECTIONS, AppSection
} from "@/store/appearanceStore";
```

Add a separate import for the modal below the store import:

```ts
import { VRChatGalleryPermissionModal } from "@/components/settings/VRChatGalleryPermissionModal";
```

- [ ] **Step 3: Add modal state to the Appearance component**

Find the appearance section component that contains the loading screen UI. Add state at the top of the component (near the other `useAppearanceStore` calls):

```ts
const [showVRChatModal, setShowVRChatModal] = useState(false);
const vrchatGalleryPath   = useAppearanceStore((s) => s.vrchatGalleryPath);
const setVrchatGalleryPath = useAppearanceStore((s) => s.setVrchatGalleryPath);
```

- [ ] **Step 4: Replace the loading screen button group with three buttons**

Find the `{/* Carousel BETA */}` button block (ends with `</button>`) and add the VRChat Gallery button immediately after it, before the closing `</div>` of the button row. Replace the entire `<div className="flex gap-3">` block with:

```tsx
<div className="flex gap-3">
    {/* Classic */}
    <button
        onClick={() => setLoadingScreen("classic")}
        className="flex-1 flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left"
        style={loadingScreen === "classic" ? {
            borderColor: "var(--accent-color)",
            background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.08)",
        } : {
            borderColor: "rgb(39,39,42)",
            background: "rgb(24,24,27)",
        }}
    >
        <div className="w-full aspect-video rounded-lg overflow-hidden flex items-center justify-center" style={{ background: "#09090b" }}>
            <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-lg" style={{ background: "rgba(220,38,38,0.3)", border: "2px solid rgba(220,38,38,0.6)" }} />
                <div className="w-12 h-0.5 rounded-full" style={{ background: "rgba(220,38,38,0.4)" }} />
            </div>
        </div>
        <div>
            <p className="text-xs font-semibold text-zinc-200">Classic</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">Logo + progress bar</p>
        </div>
    </button>

    {/* Carousel BETA */}
    <button
        onClick={() => setLoadingScreen("carousel")}
        className="flex-1 flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left"
        style={loadingScreen === "carousel" ? {
            borderColor: "var(--accent-color)",
            background: "hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.08)",
        } : {
            borderColor: "rgb(39,39,42)",
            background: "rgb(24,24,27)",
        }}
    >
        <div className="w-full aspect-video rounded-lg overflow-hidden relative" style={{ background: "#1a1a2e" }}>
            <div className="absolute inset-0 opacity-60" style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" }} />
            <div className="absolute right-2 top-2 bottom-2 flex flex-col items-center justify-center gap-1" style={{ width: 16, background: "rgba(0,0,0,0.4)", borderRadius: 4 }}>
                <div className="w-4 h-4 rounded-sm" style={{ background: "rgba(220,38,38,0.5)" }} />
                <div className="w-0.5 h-8 rounded-full" style={{ background: "rgba(255,255,255,0.2)", position: "relative" }}>
                    <div className="absolute bottom-0 left-0 right-0 rounded-full" style={{ height: "60%", background: "rgba(255,255,255,0.7)" }} />
                </div>
            </div>
            <div className="absolute bottom-2 left-2">
                <div className="w-10 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
                <div className="w-6 h-1 rounded-full mt-0.5" style={{ background: "rgba(255,255,255,0.1)" }} />
            </div>
        </div>
        <div className="flex flex-col gap-0.5">
            <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                Carousel <BetaTag />
            </p>
            <p className="text-[10px] text-zinc-500">Artwork + vertical bar</p>
        </div>
    </button>

    {/* VRChat Gallery */}
    <button
        onClick={() => {
            if (vrchatGalleryPath) {
                // Permission already granted — just activate mode
                setLoadingScreen("vrchat_gallery");
            } else {
                // Need permission — show consent modal
                setShowVRChatModal(true);
            }
        }}
        className="flex-1 flex flex-col gap-2 p-3 rounded-xl border-2 transition-all text-left"
        style={loadingScreen === "vrchat_gallery" ? {
            borderColor: "rgb(139,92,246)",
            background: "rgba(139,92,246,0.08)",
        } : {
            borderColor: "rgb(39,39,42)",
            background: "rgb(24,24,27)",
        }}
    >
        <div className="w-full aspect-video rounded-lg overflow-hidden flex items-center justify-center" style={{ background: "#1a0a2e" }}>
            <Camera className="h-8 w-8 text-violet-400 opacity-70" />
        </div>
        <div className="flex flex-col gap-0.5">
            <p className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                VRChat Gallery <BetaTag />
            </p>
            <p className="text-[10px] text-zinc-500">Tus fotos de VRChat</p>
        </div>
    </button>
</div>
```

- [ ] **Step 5: Add revocation row after the button group**

Replace the existing line `{loadingScreen === "carousel" && <CarouselImageManager />}` with:

```tsx
{loadingScreen === "carousel" && <CarouselImageManager />}

{loadingScreen === "vrchat_gallery" && (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-violet-950/20 border border-violet-800/30">
        <div className="flex items-center gap-2">
            <Camera className="h-3.5 w-3.5 text-violet-400" />
            <p className="text-xs text-violet-300 font-medium">VRChat Gallery activo</p>
        </div>
        <button
            onClick={() => {
                setVrchatGalleryPath(null);
                setLoadingScreen("carousel");
            }}
            className="text-[11px] text-zinc-500 hover:text-red-400 transition-colors"
        >
            Revocar permiso
        </button>
    </div>
)}
```

- [ ] **Step 6: Render the modal conditionally (at the end of the component's JSX return)**

Just before the outermost closing `</>` or `</div>` of the component's return, add:

```tsx
{showVRChatModal && (
    <VRChatGalleryPermissionModal onClose={() => setShowVRChatModal(false)} />
)}
```

- [ ] **Step 7: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/settings/AppearanceSection.tsx
git commit -m "feat(vrchat-gallery): add VRChat Gallery option to loading screen selector"
```

---

## Task 14: App.tsx — route "vrchat_gallery" mode to new component

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the new component**

Add to the existing imports at the top:

```ts
import { SplashScreenVRChatGallery } from "@/components/SplashScreenVRChatGallery";
```

- [ ] **Step 2: Update the splash screen routing logic**

Find the current ternary (around line 100-104):

```tsx
{!splashDone && (
  loadingScreen === "carousel" && betaFeaturesEnabled
    ? <SplashScreenCarousel onDone={handleSplashDone} />
    : <SplashScreen onDone={handleSplashDone} />
)}
```

Replace with:

```tsx
{!splashDone && (
  loadingScreen === "vrchat_gallery" && betaFeaturesEnabled
    ? <SplashScreenVRChatGallery onDone={handleSplashDone} />
    : loadingScreen === "carousel" && betaFeaturesEnabled
      ? <SplashScreenCarousel onDone={handleSplashDone} />
      : <SplashScreen onDone={handleSplashDone} />
)}
```

- [ ] **Step 3: Run tsc to verify**

```
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(vrchat-gallery): route vrchat_gallery mode to SplashScreenVRChatGallery"
```

---

## Task 15: Final verification

**Files:** No changes — verification only.

- [ ] **Step 1: Full Rust compilation check**

```
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: `Finished` with only warnings (no errors).

- [ ] **Step 2: Full TypeScript check**

```
npx tsc --noEmit
```
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Check that all seven new/modified Tauri commands are in generate_handler![]**

Verify these are all present in `src-tauri/src/lib.rs`:
- `discord_rpc_update` ✓ (existing)
- `discord_rpc_clear` ✓ (existing)
- `discord_rpc_set_enabled` ✓ (existing)
- `discord_authorize` ← new
- `discord_reauthenticate` ← new
- `discord_logout` ← new
- `detect_vrchat_photos_folder` ← new
- `scan_vrchat_photos` ← new

Also verify `discord_rpc_configure` is **NOT** in the list (it was removed).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final verification pass — cargo check + tsc clean"
```

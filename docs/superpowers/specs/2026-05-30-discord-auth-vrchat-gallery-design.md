# Discord Local RPC Auth + VRChat Gallery Carousel — Design Spec

## Overview

Two new features for VRC Studio:

1. **Discord Local RPC Authorization** — replaces the manual App ID input with a native Discord popup flow. The user clicks "Conectar", Discord shows a native authorization dialog in the desktop client, and after approval the Connections card shows the user's Discord avatar and username.

2. **VRChat Gallery Carousel** — a third loading screen mode that uses random screenshots from the user's VRChat photos folder as the splash carousel, with explicit privacy consent and revocation.

---

## Feature 1: Discord Local RPC Authorization

### Goal

Remove the developer-facing "Application ID" input from Settings → Connections. Replace it with a single "Conectar con Discord" button that triggers the Discord desktop client's native OAuth popup. After authorization, the card shows the user's Discord profile (avatar + username).

### Architecture

Two Rust modules handle Discord:

- `services/discord_rpc.rs` — existing, handles SET_ACTIVITY / CLEAR_ACTIVITY via the `discord-rich-presence` crate. Unchanged except it reads `app_id` from a compile-time constant instead of runtime state.
- `services/discord_auth.rs` — **new**. Handles the IPC handshake, AUTHORIZE, HTTP token exchange, and AUTHENTICATE commands manually via Windows named pipe (`\\.\pipe\discord-ipc-0`).

The `discord-rich-presence` crate does not expose AUTHORIZE/AUTHENTICATE commands, so `discord_auth.rs` implements the raw IPC protocol for auth only. After auth succeeds, `discord_rpc.rs` continues using the crate normally for activity updates.

### Compile-time constants (in `discord_auth.rs`)

```rust
const DISCORD_CLIENT_ID: &str = "<your_app_id>";      // registered once in Discord Developer Portal
const DISCORD_CLIENT_SECRET: &str = "<your_secret>";   // embedded in binary — standard practice for desktop apps
```

### IPC Auth Protocol (discord_auth.rs)

The raw Discord IPC protocol uses a Windows named pipe. Each message is a 4-byte opcode + 4-byte length (little-endian) + JSON payload.

Steps performed by `discord_authorize` Tauri command:

1. Open `\\.\pipe\discord-ipc-0` (fallback: `ipc-1` through `ipc-9`)
2. Send **Handshake** (opcode 0): `{"v":1,"client_id":"CLIENT_ID"}`
3. Read response (opcode 1 = FRAME) — expect `READY` event
4. Send **AUTHORIZE** frame: `{"cmd":"AUTHORIZE","args":{"client_id":"CLIENT_ID","scopes":["rpc","identify"]},"nonce":"<uuid>"}`
5. Read response — expect `{"cmd":"AUTHORIZE","data":{"code":"AUTH_CODE"}}`
6. HTTP POST to `https://discord.com/api/oauth2/token`:
   - `grant_type=authorization_code`
   - `code=AUTH_CODE`
   - `client_id=CLIENT_ID`
   - `client_secret=CLIENT_SECRET`
   - `redirect_uri=http://127.0.0.1` (must match Developer Portal setting)
7. Parse `access_token` from response
8. Send **AUTHENTICATE** frame: `{"cmd":"AUTHENTICATE","args":{"access_token":"TOKEN"},"nonce":"<uuid>"}`
9. Read response — parse `data.user`: `{ id, username, discriminator, avatar }`
10. Return `DiscordUserInfo { username, discriminator, avatar_url }` to frontend

### State

`DiscordRpcState` (existing) keeps the IPC client for activity. New `DiscordAuthState` (managed separately):

```rust
pub struct DiscordAuthState {
    pub access_token: Mutex<Option<String>>,
}
```

The access token is also persisted in `app.ts` store via localStorage (`discord_access_token`).

### Tauri Commands

| Command | Args | Returns | Description |
|---|---|---|---|
| `discord_authorize` | — | `Result<DiscordUserInfo, String>` | Full auth flow: handshake → AUTHORIZE popup → token exchange → AUTHENTICATE |
| `discord_reauthenticate` | `access_token: String` | `Result<DiscordUserInfo, String>` | Opens pipe, handshake, then AUTHENTICATE directly (skips AUTHORIZE popup). Called silently at app start. |
| `discord_logout` | — | `Result<(), String>` | Clears in-memory token, signals frontend to clear persisted state |

```rust
pub struct DiscordUserInfo {
    pub username: String,
    pub discriminator: String, // "0" for new-style usernames
    pub avatar_url: Option<String>,
}
```

### Frontend Changes

**`src/lib/tauri.ts`** — add:
- `tauriDiscordAuthorize(): Promise<DiscordUserInfo>`
- `tauriDiscordReauthenticate(token: string): Promise<DiscordUserInfo>`
- `tauriDiscordLogout(): Promise<void>`
- `interface DiscordUserInfo { username: string; discriminator: string; avatar_url: string | null }`

**`src/store/app.ts`** — add:
- `discordUser: DiscordUserInfo | null` (runtime, not persisted)
- `discordAccessToken: string | null` (persisted to localStorage as `discord_access_token`)
- `setDiscordUser(u: DiscordUserInfo | null): void`
- `setDiscordAccessToken(t: string | null): void`
- Remove `discordAppId` and `setDiscordAppId` (no longer needed)

**`src/components/settings/ConnectionsHub.tsx`** — replace `DiscordRpcSection` with a proper `ConnectionCard`-style entry:

- Status `"connected"` when `discordUser != null`, else `"disconnected"`
- `accountLine`: `@username` (omit `#discriminator` if it's `"0"`)
- `expandedContent`: avatar img + username + "Rich Presence activo" toggle (the existing enable/disable toggle)
- `onConnect`: calls `tauriDiscordAuthorize()`, on success stores token + user
- `onDisconnect`: calls `tauriDiscordLogout()`, clears token + user

**`src/App.tsx`** (app start) — silent reauthentication:
- On mount, if `discordAccessToken` exists in store, call `tauriDiscordReauthenticate(token)`
- On success: set `discordUser` in store
- On failure: clear token from store (user sees "Disconnected", reconnects with one click)

**`src/services/discord_rpc.rs`** — `DISCORD_CLIENT_ID` constant replaces the `app_id: Mutex<String>` runtime field. `discord_rpc_configure` command removed (no longer needed). `connect_client()` uses the constant directly.

### Error Handling

- Discord not running → `discord_authorize` returns `Err("Discord no está abierto. Ábrelo e inténtalo de nuevo.")`
- User clicks "Deny" in popup → `Err("Autorización denegada por el usuario.")`
- Token exchange fails → `Err("Error al obtener el token de acceso: {status}")`
- Token expired on reauth → silent `Err`, frontend clears token without showing error to user

---

## Feature 2: VRChat Gallery Carousel

### Goal

Add a third loading screen mode `"vrchat_gallery"` that picks random screenshots from the user's VRChat photos folder and displays them in the existing `SplashScreenCarousel`. Privacy-first: explicit consent dialog before accessing the folder, with one-click revocation.

### State Changes

**`src/store/appearanceStore.ts`**:
- `loadingScreen` type: `"classic" | "carousel" | "vrchat_gallery"` (was `"classic" | "carousel"`)
- Add `vrchatGalleryPath: string | null` (persisted)
- Add `setVrchatGalleryPath(p: string | null): void`

### Tauri Commands

| Command | Args | Returns | Description |
|---|---|---|---|
| `scan_vrchat_photos` | `path: Option<String>`, `count: u32` | `Result<Vec<String>, String>` | Reads the folder, filters `.jpg`/`.png`, returns up to `count` random absolute paths |
| `detect_vrchat_photos_folder` | — | `Option<String>` | Returns `%USERPROFILE%\Pictures\VRChat` if it exists, else `None` |

`scan_vrchat_photos` uses `std::fs::read_dir`, collects all `.jpg`/`.png` entries, shuffles with `rand::thread_rng()`, returns the first `count` (max 50). Returns an error if the folder doesn't exist or isn't readable.

### Activation Flow

1. User selects "VRChat Gallery" in Settings → Appearance loading screen selector
2. `VRChatGalleryPermissionModal` opens — shows:
   - Lock icon + title "Acceso a tus fotos de VRChat"
   - Body: "VRC Studio cargará imágenes de tu carpeta de capturas de VRChat para mostrarlas en la pantalla de carga. Estas imágenes **jamás se publican ni se envían a ningún servidor** — el acceso es únicamente local en tu equipo. Puedes revocar este permiso en cualquier momento desde los ajustes."
   - "Cancelar" button → modal closes, mode stays unchanged
   - "Permitir acceso" button → proceeds
3. After "Permitir acceso":
   - Call `detect_vrchat_photos_folder`
   - If folder found: `setVrchatGalleryPath(path)`, `setLoadingScreen("vrchat_gallery")`, modal closes
   - If not found: show inline message "No encontramos tu carpeta de VRChat" + "Seleccionar carpeta" button → opens Tauri `dialog::open({ directory: true })` → user picks folder → `setVrchatGalleryPath(path)`, `setLoadingScreen("vrchat_gallery")`

### Splash Screen Integration

`SplashScreenCarousel` accepts the existing `carouselImages` from the store. For the VRChat mode, the component needs photos from the backend. A new hook `useVRChatPhotos` handles this:

```ts
// src/hooks/useVRChatPhotos.ts
export function useVRChatPhotos(path: string | null): CarouselImageEntry[] {
  const [entries, setEntries] = useState<CarouselImageEntry[]>([]);
  useEffect(() => {
    if (!path) return;
    tauriScanVRChatPhotos(path, 50).then((paths) => {
      setEntries(paths.map((p, i) => ({ id: `vrc-${i}`, path: p, builtInId: null })));
    }).catch(() => setEntries([]));
  }, [path]);
  return entries;
}
```

In `App.tsx`, when `loadingScreen === "vrchat_gallery"`, render `<SplashScreenVRChatGallery>` — a thin wrapper that calls `useVRChatPhotos(vrchatGalleryPath)` and renders `<SplashScreenCarousel>` with those entries. If the hook returns an empty array (folder empty / error), falls back to built-in images.

### Revocation

In Settings → Appearance, below the loading screen selector, when mode is `"vrchat_gallery"`:

```
[VRChat Gallery activo — 47 fotos]  [Revocar permiso]
```

"Revocar permiso" → `setVrchatGalleryPath(null)` + `setLoadingScreen("carousel")`.

### Settings UI Changes

**`src/pages/Settings.tsx`** (AppearanceSection or equivalent):
- Loading screen selector gains a third option: "VRChat Gallery" (with camera icon)
- Clicking "VRChat Gallery" triggers the permission modal instead of setting the mode directly
- When mode is `"vrchat_gallery"`: show revocation row below selector

### New Files

| File | Purpose |
|---|---|
| `src-tauri/src/services/discord_auth.rs` | Raw IPC auth protocol + HTTP token exchange |
| `src/components/settings/VRChatGalleryPermissionModal.tsx` | Privacy consent modal |
| `src/hooks/useVRChatPhotos.ts` | Fetches random photo paths from backend |
| `src/components/SplashScreenVRChatGallery.tsx` | Thin wrapper: loads photos, renders SplashScreenCarousel |

### Modified Files

| File | Change |
|---|---|
| `src-tauri/src/services/discord_rpc.rs` | Use compile-time constant for App ID; remove `app_id` Mutex + `discord_rpc_configure` |
| `src-tauri/src/services/discord_auth.rs` | New — full IPC auth |
| `src-tauri/src/lib.rs` | Register new commands, manage `DiscordAuthState` |
| `src/lib/tauri.ts` | Add Discord auth + VRChat scan functions |
| `src/store/app.ts` | Add `discordUser`, `discordAccessToken`; remove `discordAppId` |
| `src/store/appearanceStore.ts` | Add `"vrchat_gallery"` mode + `vrchatGalleryPath` |
| `src/components/settings/ConnectionsHub.tsx` | Replace `DiscordRpcSection` with proper `ConnectionCard` |
| `src/App.tsx` | Silent reauth on start; route `"vrchat_gallery"` to new splash component |
| `src/pages/Settings.tsx` | Third loading screen option + revocation row |

---

## Out of Scope

- Refresh token flow (Discord access tokens last 7 days; user re-clicks Connect when expired — acceptable UX for a local desktop tool)
- VRChat video clips (`.mp4`) — images only
- Uploading or sharing photos in any way
- Multi-folder VRChat photo scanning

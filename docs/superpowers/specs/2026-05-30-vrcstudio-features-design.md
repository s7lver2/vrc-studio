# VRC Studio — 6 Feature Improvements Design Spec

**Date:** 2026-05-30

---

## Feature 1: Booth Multi-File Download Picker

### Problem
Booth items often have multiple downloadable files (different versions, variants). The current flow picks the first `/downloadables/` link found and downloads it immediately, with no choice for the user.

### Design

**New Rust command `booth_list_downloadables(source_id: String) -> Result<Vec<BoothDownloadable>, String>`**

- Opens a hidden WebView pointed at `https://booth.pm/items/{source_id}`
- JS extracts ALL anchor tags matching `/downloadables/\d+` 
- For each link: captures the display name (text content of the nearest label/filename element) and file size (text content of the sibling size element)
- Returns `Vec<BoothDownloadable> { id: String, name: String, size_bytes: u64, size_label: String }`
- If only 1 file exists, the frontend skips the modal and downloads directly (same UX as today)

**New frontend component `BoothDownloadPickerModal`**

- Triggered from `ProductCard` download button when `booth_list_downloadables` returns >1 item
- Lists each file as a row: filename + formatted size (e.g. "outfit_v2.zip — 48.3 MB")
- Single-select; "Download" button becomes active once a row is selected
- Clicking Download closes the modal and proceeds with the existing download flow using the selected `downloadable_id`

**Data flow:**
```
User clicks Download
  → booth_list_downloadables(source_id)
  → if count == 1: download directly
  → if count > 1: open BoothDownloadPickerModal
      → user selects file
      → booth_get_download_url_via_webview(source_id, downloadable_id)
      → download proceeds as normal
```

**The existing `booth_get_download_url_via_webview` command receives an optional `downloadable_id` parameter.** When provided, it navigates directly to that specific downloadable instead of picking the first one.

---

## Feature 2: Git Tab — Project Selector with Dim + Enable Git

### Problem
The git tab only shows projects with VCS enabled. Users can't easily enable git on a project from within the git tab.

### Design

**`GlobalProjectPickerModal`** receives a new optional prop: `showAllProjects?: boolean`.

When `showAllProjects` is true:
- All projects are listed (not just VCS-enabled ones)
- Projects without `vcs_enabled: true` are rendered at 50% opacity with a lock/git icon overlay
- Clicking a dimmed project shows an inline popover (absolutely positioned near the card) with the message "Git is not enabled for this project" and an **"Enable Git"** button
- Clicking "Enable Git" calls the existing `tauriUpdateProject` to set `vcs_enabled: true`, then refreshes the list and opens the project normally in the git panel

The git tab calls `GlobalProjectPickerModal` with `showAllProjects={true}`.

No changes to git functionality itself — only the picker UI.

---

## Feature 3: Booth +18 Toggle Fix

### Problem
`ConnectionsHub` manages `showAdultContent` in local `useState`, so the toggle resets on navigation. R18 products are shown unblurred regardless of the toggle.

### Design

**Part A — Global state:**
- Add `showAdultContent: boolean` (default `false`) and `setShowAdultContent(val: boolean)` to `useAppStore`
- Persist in localStorage via Zustand `persist` middleware (key already used for other settings)
- `ConnectionsHub` reads/writes `useAppStore.showAdultContent` instead of local state

**Part B — Blur overlay on cards:**
- In `ProductCard`, when `product.is_r18 === true && !showAdultContent`:
  - Render a full-card overlay: `position: absolute, inset: 0, backdrop-filter: blur(16px), background: rgba(0,0,0,0.5), z-index: 10`
  - Centered content: lock icon (Lucide `Lock`) + text "Contenido +18"
  - The entire overlay is clickable → opens activation modal
- When `showAdultContent === true`: no overlay, card renders normally

**Part C — Activation modal:**
- `AdultContentModal` component: small centered modal
  - Title: "Contenido para adultos"
  - Body: "Este contenido está marcado como solo para adultos (+18). ¿Deseas activar la visualización de contenido adulto?"
  - Buttons: "Cancelar" (dismisses) / "Activar" (calls `setShowAdultContent(true)` and dismisses)
- Shown when user clicks the blur overlay on any R18 card

---

## Feature 4: Fix Download Error — "Error desconocido buscando link de descarga"

### Problem
Two related bugs:
1. **Backend:** `tokio::select!` catches channel closure (`Err(_)`) as an error and returns "Error desconocido buscando link de descarga" even when the operation was actually cancelled cleanly
2. **Frontend:** Some error paths fail to clear the `downloading` loading state, leaving the button stuck in a spinner

### Design

**Backend fix (`booth_webview.rs` or wherever `booth_get_download_url_via_webview` lives):**
- In the `err_rx` branch of `tokio::select!`, change `Err(_) => return Err("Error desconocido...")` to `Err(_) => continue` (channel closed = sender dropped = no error)
- Only return an error when the received `String` is non-empty
- Add explicit timeout error message distinct from the "unknown" case

**Frontend fix (`ProductCard.tsx` or download handler):**
- Wrap the download call in `try/catch/finally`:
  ```ts
  setDownloading(true);
  try {
    const url = await tauriBoothGetDownloadUrl(sourceId);
    // proceed with download
  } catch (e) {
    showError(String(e));
  } finally {
    setDownloading(false);
  }
  ```
- Ensure every code path (success, error, cancellation) calls `setDownloading(false)`

---

## Feature 5: Shop "Owned" Filter Button

### Problem
The store logic already supports `priceType: "owned"` in `applyFilters()`, but there's no UI to activate it.

### Design

**`ShopFilters.tsx`** — add a toggle button next to the existing filter controls:
- Label: "Owned" with a `ShoppingBag` or `CheckCircle` Lucide icon
- When active: button has colored background (e.g. `bg-violet-600`) indicating selected state
- Clicking toggles `priceType` between `"owned"` and `"all"` in the shop store
- Mutually exclusive with other `priceType` values (free, paid) — selecting "Owned" deselects others and vice versa

No backend changes. Pure UI wiring to existing store logic.

---

## Feature 6: Discord Rich Presence

### Option selected: C — Full info display

Shows: project name, current section, time in session, "View on GitHub" button (if project has remote), Unity open/closed status, custom image per project or generic VRC Studio image.

### Design

**New Rust service `src-tauri/src/services/discord_rpc.rs`:**
- Uses `discord-sdk` or `discord-rpc-client` crate (to be determined by availability on crates.io for Tauri 2 target)
- Maintains a `Mutex<Option<DiscordClient>>` in app state
- Exposes two Tauri commands:
  - `discord_rpc_update(activity: DiscordActivity)` — sets presence
  - `discord_rpc_clear()` — clears presence (no activity shown)
- `DiscordActivity` struct:
  ```rust
  pub struct DiscordActivity {
      pub project_name: Option<String>,
      pub section: String,         // "Projects", "Shop", "Inventory", "Settings"
      pub github_url: Option<String>,
      pub unity_open: bool,
      pub session_start_ts: u64,   // Unix timestamp for "elapsed" timer
  }
  ```
- Custom images uploaded to Discord Developer Portal as assets; fallback to generic VRC Studio image

**Frontend integration:**
- `appStore` already tracks `currentSection`; add `workspaceProject` (already exists) + `unityOpenProjectIds`
- New hook `useDiscordRpc` in `src/hooks/useDiscordRpc.ts`:
  - `useEffect` watching `{ currentSection, workspaceProject, unityOpenProjectIds, discordRpcEnabled }`
  - On change: calls `tauriDiscordRpcUpdate(...)` if enabled, or `tauriDiscordRpcClear()` if disabled
  - Session start timestamp stored in `useRef` (initialized once on mount)
- Hook mounted in `App.tsx`

**Settings:**
- New section "Discord Rich Presence" in `Settings.tsx` (under Integrations or new Presence category)
- Single toggle: enabled / disabled
- Persisted as `discord_rpc_enabled` in the app settings DB (existing key-value settings table)
- When toggled off: immediately calls `tauriDiscordRpcClear()`

**Discord Application:**
- Requires a Discord Application ID configured at build time (env var `DISCORD_APP_ID`)
- Large image key: `vrcstudio` (generic) or `project_{id}` if custom image exists
- Small image key: `unity_open` / `unity_closed` for Unity status indicator

---

## Cross-cutting concerns

- All new Rust commands registered in `lib.rs` `generate_handler![]`
- All new TypeScript wrappers added to `src/lib/tauri.ts`
- No new DB migrations required (settings use existing key-value store; booth-deps manifest is TOML file)
- Existing `boothOwnedIds` set in `shopStore` drives the "owned" filter and dep resolver badge

---

## Out of scope

- Uploading custom per-project images to Discord (manual setup via Discord Developer Portal)
- Riperstore references (already removed)
- Auto-adding to booth-deps on download without active project tracking (deferred)

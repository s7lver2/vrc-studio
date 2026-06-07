# Tools System v2 — Design Spec

**Date:** 2026-06-07  
**Branch:** `feature/tools-system`  
**Status:** Approved for implementation

---

## Scope

Six work blocks that together form the second iteration of the VRC Studio Tools system:

| Block | Summary |
|---|---|
| A | SDK expansion — 6 new SDK calls, `selectProject` redesigned |
| B | Project picker redesigned as image grid |
| C | App self-SDK with debug bypass toggle |
| D | Tool packaging — `src/` (TSX) + `backend/` (Rust) structure, Vite build |
| E | avatar-perf-core rewritten to use SDK calls |
| F | Bug fix — avatar detection not finding `VRC_AvatarDescriptor` |

Blocks A–E are coupled and ship together. Block F is standalone and ships separately.

---

## Block D — Tool packaging

### Directory structure

Every tool in `vrcstudio-tools` adopts a two-directory layout:

```
<tool-name>/
  tool.json              ← manifest (extended)
  src/                   ← frontend: React + TypeScript + Vite
    App.tsx
    components/
    package.json
    vite.config.ts
    tsconfig.json
  backend/               ← sidecar: Rust binary
    src/
      main.rs
      ...
    Cargo.toml
```

`avatar-perf-core` is migrated: the current `src/` (Rust) moves to `backend/src/`, and a new `src/` (TSX) is created.

### tool.json additions

```jsonc
{
  // existing fields unchanged …

  // NEW: frontend bundle descriptor
  "frontend": {
    "entry": "src/App.tsx",      // Vite entry point
    "output": "dist/ui.js"       // compiled IIFE bundle
  },

  // npm packages bundled into ui.js via Vite
  // react + react-dom always included automatically
  "npm_dependencies": {
    "lucide-react": "^0.400.0"
  }
}
```

Tools without a `frontend` key are sidecar-only (no UI bundle).

### Build pipeline (`build.py`)

1. For each tool directory, read `tool.json`.
2. If `frontend` key present:
   - `cd src && npm install`
   - `npm run build` (calls `vite build`)
   - Output: `dist/ui.js` — IIFE bundle with React inlined, ~200–400 KB.
3. Compile `backend/` with `cargo build --release`.
4. Package `tool.json` + `dist/ui.js` + `backend/target/release/<bin>.exe` into the release ZIP.

### Vite config (template)

```ts
// src/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'App.tsx',
      name: 'ToolUI',
      formats: ['iife'],
      fileName: () => 'ui.js',
    },
    outDir: '../dist',
    rollupOptions: {
      // React inlined — no external deps
    },
  },
})
```

### App side — loading

No change to how bundles are loaded. `ToolRunner` already loads `tool.metadata.downloads.ui_bundle` path into `SdkBridge`. The `dist/ui.js` path is stored in the DB after install, same as today.

---

## Block A — SDK expansion

### New + updated method surface

| Method | Type | Notes |
|---|---|---|
| `importPackage(opts?)` | interactive | Opens `ImportSourcePicker` modal (reuses existing component) |
| `browseProjectFiles(path)` | interactive | New `FileBrowserPicker` modal, returns selected path or null |
| `browseInventoryItemFiles(id)` | interactive | Same modal, rooted at item's `installed_path` |
| `getProjectFiles(path, filter?)` | non-interactive | Returns file tree array, no UI |
| `selectProject()` | interactive | Same signature, new grid UI (Block B) |
| `runSidecar(args)` | non-interactive | Triggers the tool's own sidecar binary and returns its JSON result |

Removed from scope: `importPackageFromUrl(url)` and `importPackageFromFile(path?)`.

### Type definitions (`vrcstudio-sdk.ts`)

```ts
export interface SdkFileEntry {
  name: string;
  path: string;          // relative to browser root
  is_dir: boolean;
  extension: string | null;
  size_bytes: number | null;
}

// Added to VrcStudioSdk:
importPackage(opts?: { title?: string }): Promise<void>;
browseProjectFiles(projectPath: string): Promise<string | null>;
browseInventoryItemFiles(itemId: number): Promise<string | null>;
getProjectFiles(projectPath: string, filter?: { extensions?: string[] }): Promise<SdkFileEntry[]>;

/**
 * Run this tool's own sidecar binary.
 * The parent app calls tauriToolsRunSidecar(toolId, args) and resolves with the result.
 * Only callable from the tool's own iframe (toolId is injected by the preamble).
 */
runSidecar(args: Record<string, unknown>): Promise<unknown>;
```

### SdkPickerModals additions

New cases in the `switch`:
- `"importPackage"` → renders `ImportSourcePicker` (existing component, wrapped)
- `"browseProjectFiles"` → renders new `FileBrowserPicker` with `root = args.projectPath`
- `"browseInventoryItemFiles"` → renders `FileBrowserPicker` with `root = item.installed_path`

### FileBrowserPicker component

New component `src/components/tools/FileBrowserPicker.tsx`:

- Modal shell: same `PickerModal` wrapper as all other pickers.
- Breadcrumb bar: shows current path segments, each clickable to navigate up.
- File grid: 4-column grid of `fb-item` cards (folder icon or extension-based file icon).
- Double-click folder → navigate into it. Single-click file → resolve with that path.
- Confirm button at bottom: resolves with currently focused file path, or null on cancel.
- Calls new Tauri command `tools_list_dir(path: String) -> Vec<FileEntry>`.

### New Tauri command

`src-tauri/src/commands/tools.rs` — new command:

```rust
#[tauri::command]
pub async fn tools_list_dir(path: String) -> Result<Vec<FileEntry>, String>
```

Returns entries sorted: directories first, then files, alphabetically.

### SDK HTTP server (`sdk_server.rs`)

New routes for sidecar access:
- `POST /sdk/import-package` — emits a Tauri event that the frontend listens to; frontend opens the modal.
- `POST /sdk/get-project-files` — calls `tools_list_dir` and returns JSON.

Interactive calls (browse modals) are not available to sidecars — only to iframe tools via postMessage.

### SdkBridge preamble

New entries added to `window.vrcstudio`:

```js
importPackage:            function(o)   { return _call('importPackage', o || {}); },
browseProjectFiles:       function(p)   { return _call('browseProjectFiles', { projectPath: p }); },
browseInventoryItemFiles: function(id)  { return _call('browseInventoryItemFiles', { itemId: id }); },
getProjectFiles:          function(p,f) { return _call('getProjectFiles', { projectPath: p, filter: f || {} }); },
runSidecar:               function(a)   { return _call('runSidecar', { args: a }); },
```

---

## Block B — Project picker grid

### Visual design

`selectProject()` picker is redesigned from a flat list to a **3-column grid**:

- Each card shows: cover image (`cover_image_path` → `asset://` URL, or `last_screenshot`) at 16:9 ratio, Unity version badge (bottom-right overlay), project name, truncated path.
- Fallback when no image: zinc-800 background + generic folder icon.
- Search input at top filters by name and path (client-side).
- Modal width: 400px (wider than current 384px).

### Implementation

Replace `ProjectPicker` component inside `SdkPickerModals.tsx`:
- Remove: `<button>` list rows.
- Add: grid layout matching the validated mockup.
- Image loading uses `toAssetUrl()` helper (already in `src/lib/tauri.ts`).

---

## Block C — App self-SDK + debug toggle

### Goal

`AvatarPerf.tsx` currently calls Tauri directly (`tauriToolsScanScenes`, `tauriToolsScanAvatars`). It should route interactive calls through `useEmbeddedSdk` so the same picker modals are used consistently.

### Changes to AvatarPerf

`AvatarPerf` already accepts `onInteractive` as a prop (added in a prior commit). The change is:
- Replace `tauriToolsScanScenes(path)` with `sdk.getScenes(path)`.
- Replace `tauriToolsScanAvatars(path, scene)` with `sdk.getAvatars(path, scene)`.
- Replace inline project/scene/avatar selection steps with `sdk.selectProject()`, `sdk.selectScene()`, `sdk.selectAvatar()`.
- The component becomes a thin shell that calls SDK and renders results.

`useEmbeddedSdk` is already wired: `getScenes` calls Tauri, `selectProject` calls `onInteractive`. No new hook code needed.

### Debug toggle

New setting: `use_sdk_internally: bool` (default: `true`) stored in `app_settings`.

- Location in UI: **Settings → Debug** (new collapsible section at the bottom of Settings page).
- Label: "Use SDK internally" / "Bypass SDK (direct Tauri calls)".
- When `false`: `AvatarPerf` imports `tauriToolsScanScenes`/`tauriToolsScanAvatars` directly, skipping `useEmbeddedSdk`.
- Implemented via a prop `bypassSdk: boolean` passed from `ToolRunner` to embedded components.

### ToolRunner change

`ToolRunner` reads `use_sdk_internally` from settings store. Passes `bypassSdk={!useSdkInternally}` to embedded tool components.

---

## Block E — avatar-perf-core rewritten to use SDK

### Frontend (src/)

New React app in `avatar-perf-core/src/` that replaces the embedded `AvatarPerf.tsx` in the main app.

Entry flow:
1. `App.tsx` mounts; calls `window.vrcstudio.selectProject()` → user picks project.
2. Calls `window.vrcstudio.selectScene(projectPath)` → user picks scene.
3. Calls `window.vrcstudio.selectAvatar(projectPath, scenePath)` → user picks avatar.
4. Calls `window.vrcstudio.runSidecar({ action: "analyze", project_path, scene_path, avatar_name })`. The parent app translates this to `tauriToolsRunSidecar(toolId, args)` and resolves with the JSON result. Progress updates from the sidecar are forwarded as `setProgress` calls.
5. Renders results (metrics, recommendations) using the same visual design as current `AvatarPerfMetrics.tsx` and `AvatarPerfRecommendations.tsx`.

The tool uses `window.vrcstudio.setProgress(p, label)` for progress reporting and `window.vrcstudio.notify(msg)` for errors.

### Backend (backend/)

`avatar-perf-core/backend/` is the current `avatar-perf-core/src/` Rust code, moved with no logic changes.

### Removal from main app

Once the tool ships as a self-contained bundle, the embedded runner files are removed:
- `src/components/tools/runners/AvatarPerf.tsx`
- `src/components/tools/runners/AvatarPerfMetrics.tsx`
- `src/components/tools/runners/AvatarPerfViewport.tsx`
- `src/components/tools/runners/AvatarPerfRecommendations.tsx`

`ToolRunner.tsx` removes the `isEmbedded` special-case branch for `"avatar-performance-analyzer"`.

---

## Block F — Avatar detection bug fix (standalone)

The Rust parser in `avatar-perf-core/backend/src/unity_yaml.rs` does not correctly find `VRC_AvatarDescriptor` components in Unity 2022.3 scenes.

Root cause investigation needed before fix. Likely causes:
- Unity 2022 `.unity` files use stripped YAML with `--- !u!114` component tags; the parser may be matching on the wrong field.
- `VRC_AvatarDescriptor` may appear as a script reference (`MonoBehaviour`) with a GUID, not a named component type.

Fix: update `unity_yaml.rs` to match the correct pattern. Covered by a separate task with reproduction steps from a real scene file.

---

## Cross-cutting concerns

### SDK version bump

`vrcstudio-sdk.ts` exports a `SDK_VERSION = "2.0.0"` constant. The iframe preamble injects it as `window.vrcstudio.version`. Tools can check it for compatibility.

### Error handling

All new SDK methods reject their Promise on Tauri command errors. The iframe bridge propagates the error back to the tool via `respondError`. Tools should wrap calls in try/catch and use `notify()` to surface errors.

### Backwards compatibility

Existing tools with no `frontend` key in `tool.json` continue to work unchanged. The `isEmbedded` check in `ToolRunner` is removed only after the avatar-perf-core bundle ships.

---

## Files affected

**`vrcstudio` (main app):**
- `src/lib/vrcstudio-sdk.ts` — new types + methods
- `src/components/tools/SdkBridge.tsx` — preamble update
- `src/components/tools/SdkPickerModals.tsx` — new cases + ProjectPicker redesign
- `src/components/tools/FileBrowserPicker.tsx` — new file
- `src/components/tools/ToolRunner.tsx` — remove embedded branch, add bypassSdk prop
- `src/hooks/useEmbeddedSdk.ts` — no changes needed
- `src/components/settings/AppearanceSection.tsx` or new `DebugSection.tsx` — toggle
- `src-tauri/src/commands/tools.rs` — `tools_list_dir` command
- `src-tauri/src/tools/sdk_server.rs` — new HTTP routes
- `src-tauri/src/models/mod.rs` — `FileEntry` struct
- **Remove:** `src/components/tools/runners/AvatarPerf*.tsx` (after bundle ships)

**`vrcstudio-tools`:**
- `avatar-perf-core/backend/` ← rename from `src/`
- `avatar-perf-core/src/` ← new TSX frontend
- `avatar-perf-core/tool.json` — add `frontend` block
- `build.py` — detect `frontend`, run Vite build
- `tools/package.py` — include `dist/ui.js` in release ZIP

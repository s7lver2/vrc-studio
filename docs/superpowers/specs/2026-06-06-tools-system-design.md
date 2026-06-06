# Tools System — Design Spec
**Date:** 2026-06-06  
**Branch:** `feature/tools-system`  
**Status:** Approved

---

## 1. Overview

VRC Studio gets a **Tools** tab where users can install and run plugin-style utilities for VRChat avatar/project work. The system has two sub-projects built in sequence:

1. **Tools Framework** — the infrastructure: installed-tools tab, marketplace, detail page, install flow, sidecar lifecycle.
2. **Avatar Performance Analyzer** — the first real tool: analyzes a VRChat avatar in a Unity project and returns a VRChat performance rank + actionable recommendations.

Everything is developed on the `feature/tools-system` branch.

---

## 2. Architecture

Each tool consists of two independent layers:

| Layer | What it is | Where it lives |
|---|---|---|
| **UI Bundle** | React component (JS bundle) | `AppData/vrc-studio/tools/{id}/ui.js` |
| **Core Sidecar** | Rust binary, spawned by Tauri | `AppData/vrc-studio/tools/{id}/core.exe` (Windows) / `core` (Mac/Linux) |

For the first iteration, the Avatar Performance Analyzer UI is embedded directly in the app codebase (no dynamic JS loading yet). The `ui_bundle` field in the registry is reserved for future use and ignored in v1. The sidecar IS truly external and downloaded at install time. Dynamic JS bundle loading is a future iteration once the framework is stable.

### Stack layers

```
React UI (Tools page, Marketplace, Tool runner)
    ↕ Zustand toolsStore
Tauri Commands (tools_fetch_registry, tools_install, tools_uninstall, tools_run_sidecar)
    ↕ Rust
Sidecar Process (avatar-perf-core — stdin/stdout JSON IPC)
    ↕ File system
Unity project files (.unity scenes, Assets/, Library/)
```

### Registry

A `tools-registry.json` file hosted on GitHub (maintained by the VRC Studio developer) is the source of truth for what tools are available. It is fetched at marketplace open and cached locally with a 1-hour TTL.

```json
{
  "version": 1,
  "tools": [
    {
      "id": "avatar-performance-analyzer",
      "name": "Avatar Performance Analyzer",
      "version": "1.0.0",
      "description": "Analiza tu avatar VRChat y obtén el rank de performance con recomendaciones.",
      "author": "VRC Studio",
      "icon_url": "https://...",
      "banner_url": "https://...",
      "screenshots": ["https://..."],
      "category": "avatar",
      "downloads": {
        "ui_bundle": "https://github.com/.../avatar-perf-ui.js",
        "sidecar_windows": "https://github.com/.../avatar-perf-core.exe",
        "sidecar_macos": "https://github.com/.../avatar-perf-core",
        "sidecar_linux": "https://github.com/.../avatar-perf-core-linux"
      },
      "dependencies": [],
      "requires_unity": true,
      "min_unity_version": "2022.3"
    }
  ]
}
```

### Local persistence

New SQLite table `tools_installed`:

```sql
CREATE TABLE tools_installed (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    version     TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    metadata    TEXT NOT NULL DEFAULT '{}'  -- full registry entry JSON
);
```

---

## 3. Tools Framework UI

### 3.1 Tools Tab (`src/pages/Tools.tsx`)

The existing placeholder is replaced with:

- **Header** — title "Tools", subtitle with count of installed tools, "Marketplace →" button top-right.
- **Installed grid** — cards for each installed tool. Each card shows: icon, name, version, author, "Run" button. Empty state prompts opening the marketplace.

### 3.2 Marketplace (`src/components/tools/Marketplace.tsx`)

Opened as a full-page view within the Tools tab (replaces the grid, with a back button).

- **Top carousel** — featured tools (first N in the registry with `featured: true`).
- **Grid** — all tools from registry, 2-column. Each tile: icon, name, author, short description, "Install" / "Installed" badge.
- Clicking a tile opens the **Tool Detail** page.

### 3.3 Tool Detail Page (`src/components/tools/ToolDetail.tsx`)

- **Banner** — full-width image from `banner_url`.
- **Header row** — icon (large, rounded), name, version, author, **Install button** (or "Open" if already installed).
- **Description** — markdown-rendered body text.
- **Screenshots** — horizontal scroll of images.
- **Requirements** — list of dependencies and Unity version if required.
- **Progress bar** — shown during download/install, with filename and percentage.

### 3.4 Dependency install popup

If a tool has entries in `dependencies`, before downloading show a modal:

> "This tool requires the following to be installed:
> - [dep name] vX.Y
> Install everything? [Cancel] [Install]"

### 3.5 Install flow

1. User clicks Install on Tool Detail.
2. If dependencies exist → show popup → wait for confirm.
3. Download `sidecar_{platform}` binary to `AppData/vrc-studio/tools/{id}/core(.exe)`.
4. Mark as executable (Unix).
5. Download `ui_bundle` JS to `AppData/vrc-studio/tools/{id}/ui.js`.
6. Write entry to `tools_installed` SQLite table.
7. Update toolsStore in memory.
8. Navigate back to Tools tab — tool card is now visible.

All downloads stream progress via Tauri's `download` plugin or `reqwest` with progress callbacks → emitted as Tauri events → shown in the progress bar.

---

## 4. Avatar Performance Analyzer Tool

### 4.1 Selection flow

```
Tools tab → Run → Tool runner opens
  → Step 1: Pick Unity project (from VRC Studio projects list)
  → Step 2: Pick scene (list of .unity files found recursively in Assets/Scenes/ and Assets/)
  → Step 3: Pick avatar (GameObjects with VRC_AvatarDescriptor in scene)
  → Analysis runs → Results shown
```

Each step is a panel inside the tool runner. The user can go back at any step.

### 4.2 Tool Runner layout (`src/components/tools/runners/AvatarPerf.tsx`)

Two-panel layout:

**Left panel — 3D Viewport (320px wide)**
- Primary: image rendered by Unity headless (`Unity.exe -batchmode ...`), displayed as `<img>`.
- Fallback: Three.js canvas loading avatar mesh exported to GLTF by the sidecar. Rotates continuously. User can drag to rotate manually.
- Bottom strip: avatar name, scene path, quick stats (triangle count, material count, mesh count, platform tag).

**Right panel — Metrics**
- Platform tabs: `💻 PC [rank badge]` / `📱 Quest [rank badge]`.
- Metrics list, grouped by category, each row:
  - Left border color: red = fail, yellow = warn, green = pass.
  - Icon, metric name, limit for current rank.
  - Value (bold), mini progress bar, ✅/⚠️/❌ status icon.
- Footer: "N problems detected · M critical" + "💡 Ver recomendaciones →" button.
- Recommendations tab: list of actionable fix descriptions per failing metric.

### 4.3 Metrics analyzed (PC)

| Metric | Excellent | Good | Medium | Poor | Unity source |
|---|---|---|---|---|---|
| Triangles | ≤32k | ≤70k | ≤70k | ≤70k | SkinnedMeshRenderer + MeshFilter |
| Skinned Mesh Renderers | ≤1 | ≤2 | ≤2 | ≤8 | SkinnedMeshRenderer components |
| Mesh Renderers | ≤1 | ≤2 | ≤4 | ≤8 | MeshRenderer components |
| Material slots | ≤4 | ≤8 | ≤16 | ≤32 | sharedMaterials on all Renderers |
| Bones | ≤75 | ≤150 | ≤256 | ≤400 | Transform hierarchy under Armature |
| PhysBone Components | ≤4 | ≤8 | ≤16 | ≤32 | VRC_PhysBone MonoBehaviours |
| PhysBone Affected Transforms | ≤16 | ≤64 | ≤128 | ≤256 | Bone chains per PhysBone |
| PhysBone Colliders | ≤0 | ≤8 | ≤16 | ≤32 | VRC_PhysBoneCollider |
| Particle Systems | ≤0 | ≤8 | ≤16 | ≤32 | ParticleSystem components |
| Trail/Line Renderers | ≤1 | ≤2 | ≤4 | ≤8 | TrailRenderer, LineRenderer |
| Realtime Lights | 0 | 0 | 0 | ≤8 | Light components |
| Audio Sources | ≤1 | ≤4 | ≤8 | ≤8 | AudioSource components |
| VRAM (estimated) | ≤40 MB | ≤75 MB | ≤110 MB | ≤150 MB | Textures × size × format |

Quest limits are stricter (e.g., triangles: Excellent ≤7.5k, Good ≤10k, Medium ≤15k, Poor ≤20k). The sidecar computes both PC and Quest ranks simultaneously.

The **overall rank** is determined by the single worst individual metric rank.

### 4.4 Sidecar IPC protocol

The sidecar (`avatar-perf-core`) communicates via stdin/stdout with JSON messages.

**Request (stdin):**
```json
{
  "action": "analyze",
  "project_path": "C:/Unity/MyAvatar",
  "scene_path": "Assets/Scenes/Main.unity",
  "avatar_name": "AvatarRoot"
}
```

**Response (stdout):**
```json
{
  "ok": true,
  "avatar_name": "AvatarRoot",
  "scene": "Main.unity",
  "metrics": {
    "triangles": 87421,
    "skinned_mesh_renderers": 4,
    "mesh_renderers": 1,
    "material_slots": 12,
    "bones": 312,
    "physbone_components": 24,
    "physbone_transforms": 187,
    "physbone_colliders": 2,
    "particle_systems": 0,
    "trail_renderers": 0,
    "lights": 0,
    "audio_sources": 1,
    "vram_mb": 62.4
  },
  "rank_pc": "Poor",
  "rank_quest": "VeryPoor",
  "recommendations": [
    {
      "metric": "triangles",
      "severity": "critical",
      "current": 87421,
      "limit_good": 70000,
      "message": "Reduce triangle count by ~17k. Target the clothing and hair meshes which are typically the heaviest. Consider mesh decimation tools in Blender."
    }
  ],
  "thumbnail_path": "C:/AppData/.../tools/avatar-perf/render_cache/AvatarRoot.png"
}
```

Progress is emitted as intermediate stdout lines before the final response:
```json
{"progress": 0.1, "step": "Parsing scene file"}
{"progress": 0.4, "step": "Counting mesh triangles"}
{"progress": 0.7, "step": "Rendering avatar thumbnail (Unity headless)"}
{"progress": 1.0, "step": "Done"}
```

### 4.5 Avatar thumbnail strategy

**Primary — Unity headless render:**
1. Sidecar detects Unity version from `ProjectSettings/ProjectVersion.txt`.
2. Locates `Unity.exe` from VRC Studio's known Unity installations.
3. Launches: `Unity.exe -batchmode -projectPath {path} -executeMethod VRCStudioTools.RenderAvatar -avatarName {name} -outputPath {cache} -quit`.
4. A minimal Unity Editor script (`VRCStudioTools.cs`, injected temporarily into `Assets/Editor/`) positions camera, sets T-pose, renders 512×512 PNG. The file is deleted after Unity exits to avoid polluting the project.
5. On success: image shown in left panel.

**Fallback — GLTF + Three.js:**
1. Sidecar finds the FBX/OBJ mesh files referenced by the avatar's SkinnedMeshRenderers.
2. Converts to GLTF using the `gltf` crate (or shells out to `fbx2gltf` if available).
3. Copies referenced PNG/JPG textures alongside.
4. Returns path to `.gltf` file in the response.
5. React UI loads it with `@react-three/fiber` + `@react-three/drei`'s `useGLTF`. Avatar rotates automatically, user can drag-rotate.

---

## 5. Zustand Store (`src/store/toolsStore.ts`)

```typescript
interface InstalledTool {
  id: string;
  name: string;
  version: string;
  installed_at: string;
  enabled: boolean;
  metadata: ToolRegistryEntry;
}

interface ToolsState {
  installed: InstalledTool[];
  registry: ToolRegistryEntry[];        // fetched from GitHub
  registryLoading: boolean;
  registryLastFetch: number | null;

  load: () => Promise<void>;            // load installed from DB
  fetchRegistry: () => Promise<void>;   // fetch + cache registry
  install: (id: string, onProgress: (p: number, step: string) => void) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  runSidecar: (id: string, request: object) => Promise<object>;
}
```

---

## 6. Tauri Commands (new)

| Command | Description |
|---|---|
| `tools_list` | Returns installed tools from SQLite |
| `tools_fetch_registry` | Fetches registry JSON from GitHub, caches locally |
| `tools_install` | Downloads sidecar + UI bundle, writes to AppData, inserts DB row |
| `tools_uninstall` | Removes files + DB row |
| `tools_run_sidecar` | Spawns the tool's sidecar, sends request via stdin, streams progress events, returns final JSON |
| `tools_list_projects` | Returns Unity project list (reuses existing projects store data) |
| `tools_scan_scenes` | Scans project Assets/ for .unity scene files |
| `tools_scan_avatars` | Parses a .unity scene YAML and returns GameObjects with VRC_AvatarDescriptor |

---

## 7. New files

```
src/
  pages/Tools.tsx                          (replace placeholder)
  components/tools/
    Marketplace.tsx
    ToolDetail.tsx
    ToolCard.tsx                           (installed tool card)
    InstallProgress.tsx
    DependencyConfirmModal.tsx
    runners/
      AvatarPerf.tsx                       (tool runner UI)
      AvatarPerfViewport.tsx               (3D panel)
      AvatarPerfMetrics.tsx                (metrics panel)
      AvatarPerfRecommendations.tsx
  store/toolsStore.ts

src-tauri/src/
  tools/
    mod.rs
    registry.rs                            (fetch + cache registry)
    install.rs                             (download + install tool)
    sidecar.rs                             (spawn + IPC with sidecar)
    scan.rs                                (scene/avatar scanning)
  db/migrations/
    031_tools_installed.sql

tools/
  avatar-perf-core/                        (separate Rust crate — sidecar)
    src/
      main.rs
      analyze.rs                           (parse Unity YAML, count metrics)
      rank.rs                              (VRChat rank thresholds)
      recommendations.rs
      render.rs                            (Unity headless + GLTF fallback)
    Cargo.toml
```

---

## 8. Out of scope (this spec)

- Dynamic JS bundle loading at runtime (first tool is embedded)
- Third-party tool publishing (registry is curated)
- Auto-update of installed tools
- Tool ratings / reviews
- Quest-only avatar analysis (Quest-specific Unity project detection)

---

## 9. Open questions / risks

- **Unity headless render time**: ~15–30s may feel slow. Progress bar + intermediate step labels mitigate this. If headless is not available, fallback activates immediately.
- **Unity YAML parsing**: Unity scene files are valid YAML but use custom tags (`!u!` prefixes). The sidecar needs a Unity-aware YAML parser or a regex approach to extract component data reliably.
- **VRAM estimation**: Without loading textures through Unity's import pipeline, VRAM is estimated from raw file size × format factor. This may differ from Unity's reported VRAM. Should be labeled "estimated".
- **FBX extraction**: Unity's internal mesh format (in `Library/ArtifactDB`) is proprietary. The fallback should target the original FBX files in `Assets/`, not the imported ones.

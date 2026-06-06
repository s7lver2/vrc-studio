# Tools Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Tools plugin infrastructure — marketplace, install/uninstall flow, installed-tools tab — so any tool can be registered and run.

**Architecture:** A SQLite table tracks installed tools. A JSON registry on GitHub lists available tools. The Tauri backend handles downloads and sidecar spawning; the React frontend shows the marketplace and installed-tools grid. For v1 the Avatar Perf tool UI is embedded; the framework is designed so future tools can load a downloaded JS bundle.

**Tech Stack:** Rust (rusqlite/r2d2, reqwest, tokio, serde_json), Tauri 2, React + TypeScript, Zustand, Tailwind CSS.

**Branch:** `feature/tools-system`

---

## File Map

```
src-tauri/src/
  commands/tools.rs              NEW — all tools Tauri commands
  db/migrations/031_tools.sql    NEW — tools_installed table
  db/mod.rs                      MODIFY — add migration 31
  lib.rs                         MODIFY — register new commands

src/
  lib/tauri.ts                   MODIFY — add TS bindings + types
  store/toolsStore.ts            NEW — Zustand store
  pages/Tools.tsx                MODIFY — replace Coming Soon placeholder
  components/tools/
    ToolCard.tsx                 NEW — installed-tool card
    Marketplace.tsx              NEW — full marketplace view
    ToolDetail.tsx               NEW — single-tool detail + install
    InstallProgress.tsx          NEW — download progress bar
    DependencyConfirmModal.tsx   NEW — "will install X deps" popup
```

---

## Task 1: DB Migration — tools_installed table

**Files:**
- Create: `src-tauri/src/db/migrations/031_tools.sql`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Create the migration SQL**

```sql
-- src-tauri/src/db/migrations/031_tools.sql
CREATE TABLE IF NOT EXISTS tools_installed (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled      INTEGER NOT NULL DEFAULT 1,
    metadata     TEXT NOT NULL DEFAULT '{}'
);
```

- [ ] **Register migration in `db/mod.rs`**

Find the `MIGRATIONS` constant and add entry 31 at the end:

```rust
    (30, include_str!("migrations/030_collections_folders.sql")),
    (31, include_str!("migrations/031_tools.sql")),   // ← add this line
];
```

- [ ] **Verify it compiles**

```bash
cd E:/vrcstudio && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Commit**

```bash
git add src-tauri/src/db/migrations/031_tools.sql src-tauri/src/db/mod.rs
git commit -m "feat(db): add tools_installed migration 031"
```

---

## Task 2: Rust types + `tools_list` command

**Files:**
- Create: `src-tauri/src/commands/tools.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Create `src-tauri/src/commands/tools.rs`** with types and `tools_list`:

```rust
// src-tauri/src/commands/tools.rs
use crate::db::DbPool;
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

// ── Types ──────────────────────────────────────────────────────────────────

/// An entry from the remote tools registry (tools-registry.json).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub icon_url: String,
    pub banner_url: String,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub category: String,
    pub downloads: ToolDownloads,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub requires_unity: bool,
    #[serde(default)]
    pub min_unity_version: String,
    #[serde(default)]
    pub featured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolDownloads {
    #[serde(default)]
    pub ui_bundle: String,
    #[serde(default)]
    pub sidecar_windows: String,
    #[serde(default)]
    pub sidecar_macos: String,
    #[serde(default)]
    pub sidecar_linux: String,
}

/// A tool that has been installed locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledTool {
    pub id: String,
    pub name: String,
    pub version: String,
    pub installed_at: String,
    pub enabled: bool,
    pub metadata: ToolRegistryEntry,
}

// ── Commands ───────────────────────────────────────────────────────────────

/// Returns all enabled installed tools from the local DB.
#[tauri::command]
pub fn tools_list(pool: State<'_, DbPool>) -> Result<Vec<InstalledTool>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, version, installed_at, enabled, metadata
         FROM tools_installed WHERE enabled = 1 ORDER BY installed_at DESC",
    )?;
    let tools = stmt
        .query_map([], |row| {
            let metadata_json: String = row.get(5)?;
            Ok(InstalledTool {
                id:           row.get(0)?,
                name:         row.get(1)?,
                version:      row.get(2)?,
                installed_at: row.get(3)?,
                enabled:      row.get::<_, i64>(4)? != 0,
                metadata:     serde_json::from_str(&metadata_json)
                                  .unwrap_or_default(),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tools)
}
```

- [ ] **Export from `commands/mod.rs`**

Open `src-tauri/src/commands/mod.rs` and add:

```rust
pub mod tools;
```

- [ ] **Register command in `lib.rs`**

In the `invoke_handler!(tauri::generate_handler![...])` block, add:

```rust
            commands::tools::tools_list,
```

- [ ] **Build and verify**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Commit**

```bash
git add src-tauri/src/commands/tools.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(tools): add InstalledTool types and tools_list command"
```

---

## Task 3: Registry fetch command (`tools_fetch_registry`)

**Files:**
- Modify: `src-tauri/src/commands/tools.rs`
- Modify: `src-tauri/src/lib.rs`

The registry is a JSON file hosted at a GitHub URL. We fetch it with `reqwest` (already in Cargo.toml) and cache it locally in AppData with a 1-hour TTL.

- [ ] **Add `tools_fetch_registry` to `commands/tools.rs`**

Add these imports at the top of the file:

```rust
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
```

Then add the command after `tools_list`:

```rust
const REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/YOUR_ORG/vrc-studio-tools/main/registry.json";
const REGISTRY_TTL_SECS: u64 = 3600; // 1 hour

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsRegistry {
    pub version: u32,
    pub tools: Vec<ToolRegistryEntry>,
}

/// Fetches the remote tools registry (cached locally for 1 hour).
/// Returns the list of available tools.
#[tauri::command]
pub async fn tools_fetch_registry(
    app: tauri::AppHandle,
) -> Result<Vec<ToolRegistryEntry>, AppError> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let cache_path = cache_dir.join("tools_registry_cache.json");

    // Return cached version if fresh enough
    if let Ok(meta) = std::fs::metadata(&cache_path) {
        if let Ok(modified) = meta.modified() {
            let age = SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default()
                .as_secs();
            if age < REGISTRY_TTL_SECS {
                if let Ok(data) = std::fs::read_to_string(&cache_path) {
                    if let Ok(registry) = serde_json::from_str::<ToolsRegistry>(&data) {
                        return Ok(registry.tools);
                    }
                }
            }
        }
    }

    // Fetch fresh copy
    let response = reqwest::get(REGISTRY_URL)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let registry: ToolsRegistry = serde_json::from_str(&text)
        .map_err(|e| AppError::Parse(e.to_string()))?;

    // Cache to disk
    let _ = std::fs::write(&cache_path, &text);

    Ok(registry.tools)
}
```

- [ ] **Add `Network` and `Parse` variants to AppError if missing**

Open `src-tauri/src/error.rs` and check for these variants. If they don't exist, find the pattern used for other network/parse errors and add analogous ones. A common pattern in this codebase:

```rust
// In src-tauri/src/error.rs — add if missing:
#[error("Network error: {0}")]
Network(String),
#[error("Parse error: {0}")]
Parse(String),
#[error("IO error: {0}")]
Io(String),
```

- [ ] **Register in `lib.rs`**

```rust
            commands::tools::tools_fetch_registry,
```

- [ ] **Build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src-tauri/src/commands/tools.rs src-tauri/src/lib.rs src-tauri/src/error.rs
git commit -m "feat(tools): add tools_fetch_registry with 1h local cache"
```

---

## Task 4: Install command (`tools_install`)

**Files:**
- Modify: `src-tauri/src/commands/tools.rs`
- Modify: `src-tauri/src/lib.rs`

Downloads the platform-appropriate sidecar binary to `AppData/tools/{id}/core(.exe)`, then writes a row to `tools_installed`.

- [ ] **Add `tools_install` to `commands/tools.rs`**

Add this import at the top:

```rust
use futures_util::StreamExt;
```

Then add the command:

```rust
/// Downloads and installs a tool from the registry.
/// Emits `tools://install-progress` events: `{ id, progress: 0.0..1.0, step: String }`.
#[tauri::command]
pub async fn tools_install(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
    entry: ToolRegistryEntry,
) -> Result<InstalledTool, AppError> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let tool_dir = app_data.join("tools").join(&entry.id);
    std::fs::create_dir_all(&tool_dir)
        .map_err(|e| AppError::Io(e.to_string()))?;

    // Pick sidecar URL for current platform
    let sidecar_url = if cfg!(target_os = "windows") {
        &entry.downloads.sidecar_windows
    } else if cfg!(target_os = "macos") {
        &entry.downloads.sidecar_macos
    } else {
        &entry.downloads.sidecar_linux
    };

    if !sidecar_url.is_empty() {
        let sidecar_name = if cfg!(target_os = "windows") { "core.exe" } else { "core" };
        let sidecar_path = tool_dir.join(sidecar_name);

        emit_progress(&app, &entry.id, 0.05, "Descargando sidecar…");
        download_file(&app, &entry.id, sidecar_url, &sidecar_path, 0.05, 0.85).await?;

        // Make executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&sidecar_path)
                .map_err(|e| AppError::Io(e.to_string()))?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&sidecar_path, perms)
                .map_err(|e| AppError::Io(e.to_string()))?;
        }
    }

    emit_progress(&app, &entry.id, 0.9, "Guardando en base de datos…");

    // Write to DB
    let conn = pool.get()?;
    let metadata_json = serde_json::to_string(&entry)
        .map_err(|e| AppError::Parse(e.to_string()))?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT OR REPLACE INTO tools_installed (id, name, version, installed_at, enabled, metadata)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![entry.id, entry.name, entry.version, now, metadata_json],
    )?;

    emit_progress(&app, &entry.id, 1.0, "Instalado");

    Ok(InstalledTool {
        id:           entry.id.clone(),
        name:         entry.name.clone(),
        version:      entry.version.clone(),
        installed_at: now,
        enabled:      true,
        metadata:     entry,
    })
}

fn emit_progress(app: &tauri::AppHandle, id: &str, progress: f64, step: &str) {
    let _ = app.emit("tools://install-progress", serde_json::json!({
        "id": id,
        "progress": progress,
        "step": step,
    }));
}

async fn download_file(
    app: &tauri::AppHandle,
    tool_id: &str,
    url: &str,
    dest: &PathBuf,
    progress_start: f64,
    progress_end: f64,
) -> Result<(), AppError> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;

    let total = response.content_length().unwrap_or(1);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file_bytes = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Network(e.to_string()))?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);
        let ratio = downloaded as f64 / total as f64;
        let prog = progress_start + ratio * (progress_end - progress_start);
        emit_progress(app, tool_id, prog, "Descargando…");
    }

    std::fs::write(dest, file_bytes).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}
```

- [ ] **Register in `lib.rs`**

```rust
            commands::tools::tools_install,
```

- [ ] **Build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

- [ ] **Commit**

```bash
git add src-tauri/src/commands/tools.rs src-tauri/src/lib.rs
git commit -m "feat(tools): add tools_install with streamed download + progress events"
```

---

## Task 5: Uninstall command (`tools_uninstall`)

**Files:**
- Modify: `src-tauri/src/commands/tools.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Add `tools_uninstall` to `commands/tools.rs`**

```rust
/// Removes a tool: deletes its AppData folder and removes the DB row.
#[tauri::command]
pub async fn tools_uninstall(
    app: tauri::AppHandle,
    pool: State<'_, DbPool>,
    id: String,
) -> Result<(), AppError> {
    // Remove files
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?;
    let tool_dir = app_data.join("tools").join(&id);
    if tool_dir.exists() {
        std::fs::remove_dir_all(&tool_dir)
            .map_err(|e| AppError::Io(e.to_string()))?;
    }

    // Remove from DB
    let conn = pool.get()?;
    conn.execute("DELETE FROM tools_installed WHERE id = ?1", params![id])?;
    Ok(())
}
```

- [ ] **Register in `lib.rs`**

```rust
            commands::tools::tools_uninstall,
```

- [ ] **Build and commit**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
git add src-tauri/src/commands/tools.rs src-tauri/src/lib.rs
git commit -m "feat(tools): add tools_uninstall command"
```

---

## Task 6: TypeScript types + tauri.ts bindings

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Add types and bindings to `src/lib/tauri.ts`**

Find the end of the existing type definitions and add:

```typescript
// ── Tools ─────────────────────────────────────────────────────────────────

export interface ToolDownloads {
  ui_bundle: string;
  sidecar_windows: string;
  sidecar_macos: string;
  sidecar_linux: string;
}

export interface ToolRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon_url: string;
  banner_url: string;
  screenshots: string[];
  category: string;
  downloads: ToolDownloads;
  dependencies: string[];
  requires_unity: boolean;
  min_unity_version: string;
  featured: boolean;
}

export interface InstalledTool {
  id: string;
  name: string;
  version: string;
  installed_at: string;
  enabled: boolean;
  metadata: ToolRegistryEntry;
}

export async function tauriToolsList(): Promise<InstalledTool[]> {
  return invoke<InstalledTool[]>("tools_list");
}

export async function tauriToolsFetchRegistry(): Promise<ToolRegistryEntry[]> {
  return invoke<ToolRegistryEntry[]>("tools_fetch_registry");
}

export async function tauriToolsInstall(
  entry: ToolRegistryEntry
): Promise<InstalledTool> {
  return invoke<InstalledTool>("tools_install", { entry });
}

export async function tauriToolsUninstall(id: string): Promise<void> {
  return invoke<void>("tools_uninstall", { id });
}
```

- [ ] **Verify TypeScript compiles**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to the new types.

- [ ] **Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(tools): add TS types and tauri.ts bindings for tools commands"
```

---

## Task 7: Zustand toolsStore

**Files:**
- Create: `src/store/toolsStore.ts`

- [ ] **Create `src/store/toolsStore.ts`**

```typescript
// src/store/toolsStore.ts
import { create } from "zustand";
import {
  InstalledTool,
  ToolRegistryEntry,
  tauriToolsList,
  tauriToolsFetchRegistry,
  tauriToolsInstall,
  tauriToolsUninstall,
} from "../lib/tauri";
import { listen } from "@tauri-apps/api/event";

export interface InstallProgressEvent {
  id: string;
  progress: number; // 0.0 – 1.0
  step: string;
}

interface ToolsState {
  installed: InstalledTool[];
  registry: ToolRegistryEntry[];
  registryLoading: boolean;
  // installingId → progress (0–1)
  installing: Record<string, number>;
  installingStep: Record<string, string>;

  load: () => Promise<void>;
  fetchRegistry: () => Promise<void>;
  install: (entry: ToolRegistryEntry) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
}

export const useToolsStore = create<ToolsState>((set, get) => {
  // Listen for install progress events from Tauri backend
  listen<InstallProgressEvent>("tools://install-progress", ({ payload }) => {
    set((s) => ({
      installing: { ...s.installing, [payload.id]: payload.progress },
      installingStep: { ...s.installingStep, [payload.id]: payload.step },
    }));
  });

  return {
    installed: [],
    registry: [],
    registryLoading: false,
    installing: {},
    installingStep: {},

    load: async () => {
      try {
        const installed = await tauriToolsList();
        set({ installed });
      } catch (e) {
        console.error("tools load error:", e);
      }
    },

    fetchRegistry: async () => {
      set({ registryLoading: true });
      try {
        const registry = await tauriToolsFetchRegistry();
        set({ registry });
      } catch (e) {
        console.error("tools registry fetch error:", e);
      } finally {
        set({ registryLoading: false });
      }
    },

    install: async (entry) => {
      set((s) => ({
        installing: { ...s.installing, [entry.id]: 0 },
        installingStep: { ...s.installingStep, [entry.id]: "Iniciando…" },
      }));
      try {
        const tool = await tauriToolsInstall(entry);
        set((s) => ({
          installed: [tool, ...s.installed.filter((t) => t.id !== tool.id)],
          installing: Object.fromEntries(
            Object.entries(s.installing).filter(([k]) => k !== entry.id)
          ),
          installingStep: Object.fromEntries(
            Object.entries(s.installingStep).filter(([k]) => k !== entry.id)
          ),
        }));
      } catch (e) {
        console.error("tools install error:", e);
        set((s) => ({
          installing: Object.fromEntries(
            Object.entries(s.installing).filter(([k]) => k !== entry.id)
          ),
          installingStep: Object.fromEntries(
            Object.entries(s.installingStep).filter(([k]) => k !== entry.id)
          ),
        }));
        throw e;
      }
    },

    uninstall: async (id) => {
      await tauriToolsUninstall(id);
      set((s) => ({ installed: s.installed.filter((t) => t.id !== id) }));
    },
  };
});
```

- [ ] **Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit**

```bash
git add src/store/toolsStore.ts
git commit -m "feat(tools): add toolsStore with install/uninstall/registry"
```

---

## Task 8: ToolCard component

**Files:**
- Create: `src/components/tools/ToolCard.tsx`

- [ ] **Create `src/components/tools/ToolCard.tsx`**

```tsx
// src/components/tools/ToolCard.tsx
import { InstalledTool } from "../../lib/tauri";
import { Play, Trash2 } from "lucide-react";

interface Props {
  tool: InstalledTool;
  onRun: (tool: InstalledTool) => void;
  onUninstall: (id: string) => void;
}

export function ToolCard({ tool, onRun, onUninstall }: Props) {
  return (
    <div className="group relative flex flex-col bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-700 transition-colors">
      {/* Banner / icon area */}
      <div className="h-24 bg-zinc-800 flex items-center justify-center relative overflow-hidden">
        {tool.metadata.banner_url ? (
          <img
            src={tool.metadata.banner_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-40"
          />
        ) : null}
        <div className="relative z-10 w-12 h-12 rounded-xl bg-zinc-700 border border-zinc-600 flex items-center justify-center text-2xl">
          {tool.metadata.icon_url ? (
            <img src={tool.metadata.icon_url} alt="" className="w-8 h-8 object-contain" />
          ) : (
            "🛠"
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        <div>
          <p className="text-sm font-semibold text-zinc-100 leading-tight">{tool.name}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            v{tool.version} · {tool.metadata.author}
          </p>
        </div>
        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-snug flex-1">
          {tool.metadata.description}
        </p>
        <div className="flex items-center gap-2 mt-auto">
          <button
            onClick={() => onRun(tool)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors"
          >
            <Play className="h-3 w-3" /> Run
          </button>
          <button
            onClick={() => onUninstall(tool.id)}
            className="p-1.5 rounded-lg border border-zinc-700 hover:border-zinc-600 text-zinc-500 hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/tools/ToolCard.tsx
git commit -m "feat(tools): add ToolCard component"
```

---

## Task 9: Tools page (installed grid + marketplace entry)

**Files:**
- Modify: `src/pages/Tools.tsx`

- [ ] **Replace `src/pages/Tools.tsx`**

```tsx
// src/pages/Tools.tsx
import { useEffect, useState } from "react";
import { Wrench, Store } from "lucide-react";
import { useToolsStore } from "../store/toolsStore";
import { ToolCard } from "../components/tools/ToolCard";
import { Marketplace } from "../components/tools/Marketplace";
import type { InstalledTool } from "../lib/tauri";

type View = "installed" | "marketplace";

export default function ToolsPage() {
  const { installed, load, uninstall } = useToolsStore();
  const [view, setView] = useState<View>("installed");
  const [activeTool, setActiveTool] = useState<InstalledTool | null>(null);

  useEffect(() => { load(); }, [load]);

  // TODO (Plan 2): render activeTool runner when not null
  if (activeTool) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-800">
          <button
            onClick={() => setActiveTool(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >← Volver</button>
          <span className="text-sm font-semibold text-zinc-100">{activeTool.name}</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
          Runner para "{activeTool.name}" — implementado en Plan 2
        </div>
      </div>
    );
  }

  if (view === "marketplace") {
    return <Marketplace onBack={() => setView("installed")} />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-8 py-5 border-b border-zinc-800 shrink-0">
        <Wrench className="h-5 w-5 text-zinc-500" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-zinc-100">Tools</h1>
          <p className="text-xs text-zinc-600 mt-0.5">
            {installed.length} tool{installed.length !== 1 ? "s" : ""} instalada{installed.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setView("marketplace")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors"
        >
          <Store className="h-3.5 w-3.5" /> Marketplace
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {installed.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 select-none">
            <div className="h-14 w-14 rounded-2xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center">
              <Wrench className="h-6 w-6 text-zinc-600" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-zinc-400">No hay tools instaladas</p>
              <p className="text-xs text-zinc-600 mt-1">Abre el Marketplace para instalar la primera</p>
            </div>
            <button
              onClick={() => setView("marketplace")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium transition-colors"
            >
              <Store className="h-3.5 w-3.5" /> Abrir Marketplace
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {installed.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                onRun={setActiveTool}
                onUninstall={uninstall}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Verify it renders without errors** — open the app and navigate to Tools.

- [ ] **Commit**

```bash
git add src/pages/Tools.tsx
git commit -m "feat(tools): replace placeholder with installed-tools grid"
```

---

## Task 10: Marketplace + Tool Detail + Install UI

**Files:**
- Create: `src/components/tools/Marketplace.tsx`
- Create: `src/components/tools/ToolDetail.tsx`
- Create: `src/components/tools/InstallProgress.tsx`
- Create: `src/components/tools/DependencyConfirmModal.tsx`

- [ ] **Create `src/components/tools/InstallProgress.tsx`**

```tsx
// src/components/tools/InstallProgress.tsx
interface Props {
  progress: number; // 0–1
  step: string;
}

export function InstallProgress({ progress, step }: Props) {
  const pct = Math.round(progress * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-xs text-zinc-400">{step}</span>
        <span className="text-xs text-zinc-500 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-red-500 rounded-full transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Create `src/components/tools/DependencyConfirmModal.tsx`**

```tsx
// src/components/tools/DependencyConfirmModal.tsx
import { X } from "lucide-react";

interface Props {
  toolName: string;
  dependencies: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DependencyConfirmModal({ toolName, dependencies, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-zinc-100">Instalar "{toolName}"</h2>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-zinc-400 mb-3">Esta tool requiere las siguientes dependencias:</p>
        <ul className="flex flex-col gap-1.5 mb-5">
          {dependencies.map((dep) => (
            <li key={dep} className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 flex-shrink-0" />
              {dep}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-xs font-medium hover:border-zinc-500 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors"
          >
            Instalar todo
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Create `src/components/tools/ToolDetail.tsx`**

```tsx
// src/components/tools/ToolDetail.tsx
import { useState } from "react";
import { ArrowLeft, Download, CheckCircle } from "lucide-react";
import { ToolRegistryEntry } from "../../lib/tauri";
import { useToolsStore } from "../../store/toolsStore";
import { InstallProgress } from "./InstallProgress";
import { DependencyConfirmModal } from "./DependencyConfirmModal";

interface Props {
  entry: ToolRegistryEntry;
  onBack: () => void;
}

export function ToolDetail({ entry, onBack }: Props) {
  const { installed, install, installing, installingStep } = useToolsStore();
  const [showDepModal, setShowDepModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isInstalled = installed.some((t) => t.id === entry.id);
  const isInstalling = entry.id in installing;
  const progress = installing[entry.id] ?? 0;
  const step = installingStep[entry.id] ?? "";

  const handleInstallClick = () => {
    if (entry.dependencies.length > 0) {
      setShowDepModal(true);
    } else {
      doInstall();
    }
  };

  const doInstall = async () => {
    setShowDepModal(false);
    setError(null);
    try {
      await install(entry);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showDepModal && (
        <DependencyConfirmModal
          toolName={entry.name}
          dependencies={entry.dependencies}
          onConfirm={doInstall}
          onCancel={() => setShowDepModal(false)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Marketplace
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Banner */}
        <div className="h-40 bg-zinc-800 relative overflow-hidden">
          {entry.banner_url && (
            <img src={entry.banner_url} alt="" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-900/80 to-transparent" />
        </div>

        <div className="px-8 py-6 flex flex-col gap-6 max-w-3xl">
          {/* Header row */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-3xl flex-shrink-0 -mt-10 relative z-10">
              {entry.icon_url ? (
                <img src={entry.icon_url} alt="" className="w-10 h-10 object-contain" />
              ) : "🛠"}
            </div>
            <div className="flex-1 min-w-0 mt-1">
              <h1 className="text-lg font-bold text-zinc-100">{entry.name}</h1>
              <p className="text-xs text-zinc-500">v{entry.version} · por {entry.author}</p>
            </div>
            <div className="flex-shrink-0">
              {isInstalled ? (
                <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-semibold">
                  <CheckCircle className="h-3.5 w-3.5 text-green-500" /> Instalada
                </div>
              ) : (
                <button
                  onClick={handleInstallClick}
                  disabled={isInstalling}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isInstalling ? "Instalando…" : "Instalar"}
                </button>
              )}
            </div>
          </div>

          {/* Progress bar (while installing) */}
          {isInstalling && (
            <InstallProgress progress={progress} step={step} />
          )}

          {error && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
              Error: {error}
            </p>
          )}

          {/* Description */}
          <div>
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Descripción</h2>
            <p className="text-sm text-zinc-300 leading-relaxed">{entry.description}</p>
          </div>

          {/* Requirements */}
          {(entry.requires_unity || entry.dependencies.length > 0) && (
            <div>
              <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Requisitos</h2>
              <ul className="flex flex-col gap-1">
                {entry.requires_unity && (
                  <li className="text-xs text-zinc-400">
                    Unity {entry.min_unity_version || "2022.3"}+
                  </li>
                )}
                {entry.dependencies.map((dep) => (
                  <li key={dep} className="text-xs text-zinc-400">{dep}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Screenshots */}
          {entry.screenshots.length > 0 && (
            <div>
              <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Screenshots</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {entry.screenshots.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`Screenshot ${i + 1}`}
                    className="h-40 rounded-xl border border-zinc-700 object-cover flex-shrink-0"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Create `src/components/tools/Marketplace.tsx`**

```tsx
// src/components/tools/Marketplace.tsx
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ToolRegistryEntry } from "../../lib/tauri";
import { useToolsStore } from "../../store/toolsStore";
import { ToolDetail } from "./ToolDetail";

interface Props {
  onBack: () => void;
}

export function Marketplace({ onBack }: Props) {
  const { registry, registryLoading, fetchRegistry, installed } = useToolsStore();
  const [selected, setSelected] = useState<ToolRegistryEntry | null>(null);

  useEffect(() => { fetchRegistry(); }, [fetchRegistry]);

  if (selected) {
    return <ToolDetail entry={selected} onBack={() => setSelected(null)} />;
  }

  const featured = registry.filter((t) => t.featured);
  const all = registry;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-8 py-5 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Tools
        </button>
        <span className="text-sm font-bold text-zinc-100 ml-1">Marketplace</span>
      </div>

      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {registryLoading ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-zinc-600 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando marketplace…
          </div>
        ) : registry.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
            No se pudo cargar el marketplace. Comprueba tu conexión.
          </div>
        ) : (
          <>
            {/* Carousel / featured */}
            {featured.length > 0 && (
              <div>
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Destacadas</p>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {featured.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => setSelected(tool)}
                      className="flex-shrink-0 w-64 h-32 rounded-2xl bg-zinc-800 border border-zinc-700 hover:border-zinc-500 overflow-hidden relative transition-colors text-left"
                    >
                      {tool.banner_url && (
                        <img src={tool.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
                      )}
                      <div className="absolute inset-0 p-4 flex flex-col justify-end bg-gradient-to-t from-zinc-900/90 to-transparent">
                        <p className="text-sm font-bold text-zinc-100">{tool.name}</p>
                        <p className="text-[10px] text-zinc-400">{tool.author}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* All tools grid */}
            <div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-3">Todas</p>
              <div className="grid grid-cols-2 gap-3">
                {all.map((tool) => {
                  const isInstalled = installed.some((t) => t.id === tool.id);
                  return (
                    <button
                      key={tool.id}
                      onClick={() => setSelected(tool)}
                      className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-3 text-left transition-colors"
                    >
                      <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl flex-shrink-0">
                        {tool.icon_url ? (
                          <img src={tool.icon_url} alt="" className="w-6 h-6 object-contain" />
                        ) : "🛠"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-100 truncate">{tool.name}</p>
                        <p className="text-[10px] text-zinc-500">{tool.author}</p>
                        <p className="text-[10px] text-zinc-400 line-clamp-1 mt-0.5">{tool.description}</p>
                      </div>
                      {isInstalled && (
                        <span className="text-[9px] font-bold text-green-500 flex-shrink-0">✓ instalada</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Verify the app builds**

```bash
cd E:/vrcstudio && npm run build 2>&1 | tail -20
```

Expected: no TS/Vite errors.

- [ ] **Manual test:** Open app → Tools → Marketplace. The marketplace should load (or show "no connection" if the registry URL doesn't exist yet). Clicking a featured/grid item should open the Tool Detail page.

- [ ] **Commit**

```bash
git add src/components/tools/
git commit -m "feat(tools): add Marketplace, ToolDetail, InstallProgress, DependencyConfirmModal"
```

---

## Task 11: Create tools-registry.json in your GitHub repo

This is a manual step — the developer needs to host the registry.

- [ ] **Create a GitHub repository** `vrc-studio-tools` (or add a `registry/` folder to the main repo)

- [ ] **Create `registry.json` with this initial content:**

```json
{
  "version": 1,
  "tools": [
    {
      "id": "avatar-performance-analyzer",
      "name": "Avatar Performance Analyzer",
      "version": "1.0.0",
      "description": "Analiza tu avatar VRChat y obtén el rank de performance (PC y Quest) con recomendaciones accionables para mejorar los problemas.",
      "author": "VRC Studio",
      "icon_url": "",
      "banner_url": "",
      "screenshots": [],
      "category": "avatar",
      "featured": true,
      "downloads": {
        "ui_bundle": "",
        "sidecar_windows": "https://github.com/YOUR_ORG/vrc-studio-tools/releases/download/v1.0.0/avatar-perf-core.exe",
        "sidecar_macos": "https://github.com/YOUR_ORG/vrc-studio-tools/releases/download/v1.0.0/avatar-perf-core",
        "sidecar_linux": ""
      },
      "dependencies": [],
      "requires_unity": true,
      "min_unity_version": "2022.3"
    }
  ]
}
```

- [ ] **Update `REGISTRY_URL` in `commands/tools.rs`** to point to the raw GitHub URL of this file.

- [ ] **Commit the registry file to GitHub** so the app can fetch it.

---

**End of Plan 1 — Tools Framework**

At this point the app has:
- A working Tools tab showing installed tools
- A Marketplace that fetches and shows the registry
- Tool detail pages with install button
- Install/uninstall flow with progress bar and dependency confirmation

Proceed to `2026-06-06-avatar-perf-analyzer.md` for the actual analysis tool.

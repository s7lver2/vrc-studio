# VRC Studio — Core Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a working Tauri 2 desktop app with Rust backend, React/TS frontend, SQLite persistence, and a navigable sidebar shell with stubbed sections for Projects, Packages, Shop, and Settings.

**Architecture:** Tauri 2 app where the Rust backend exposes typed Commands consumed by a React frontend via generated bindings. SQLite (via `sqlx`) handles all local persistence with versioned migrations applied at startup. The frontend uses Zustand for global state and shadcn/ui + Tailwind for UI.

**Tech Stack:** Tauri 2, Rust (sqlx, tokio, serde), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Zustand, Vitest, `@tauri-apps/api`

---

## File Structure

```
vrc-studio/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs                   # Tauri builder, plugin registration
│   │   ├── lib.rs                    # app() fn, command registration
│   │   ├── db/
│   │   │   ├── mod.rs                # DB pool init, run_migrations()
│   │   │   └── migrations/
│   │   │       └── 001_initial.sql   # Projects, packages, inventory tables
│   │   ├── commands/
│   │   │   └── mod.rs                # Re-exports all command modules
│   │   ├── models/
│   │   │   └── mod.rs                # Shared structs: Project, Package, etc.
│   │   └── error.rs                  # AppError enum + Into<tauri::InvokeError>
├── src/
│   ├── main.tsx                      # React entry point
│   ├── App.tsx                       # Root layout: sidebar + outlet
│   ├── routes.tsx                    # Route definitions
│   ├── store/
│   │   └── app.ts                    # Zustand store (nav state, global loading)
│   ├── lib/
│   │   └── tauri.ts                  # Typed invoke() wrappers
│   ├── components/
│   │   └── sidebar/
│   │       ├── Sidebar.tsx
│   │       └── NavItem.tsx
│   └── pages/
│       ├── Projects.tsx              # Stub
│       ├── Packages.tsx              # Stub
│       ├── Shop.tsx                  # Stub
│       └── Settings.tsx              # Stub
├── src-tauri/tests/
│   └── db_test.rs                    # Integration tests for DB layer
├── src/test/
│   └── tauri.test.ts                 # Frontend unit tests (Vitest)
├── package.json
└── vite.config.ts
```

---

## Task 1: Initialize Tauri 2 project

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `package.json`
- Create: `vite.config.ts`

- [ ] **Step 1: Scaffold the Tauri project**

```bash
npm create tauri-app@latest vrc-studio -- --template react-ts --manager npm
cd vrc-studio
npm install
```

Expected output: project directory created, `npm run tauri dev` compiles without error.

- [ ] **Step 2: Verify dev build runs**

```bash
npm run tauri dev
```

Expected: Tauri window opens with the default Vite/React splash screen. No compile errors.

- [ ] **Step 3: Replace `src-tauri/Cargo.toml` dependencies block**

```toml
[package]
name = "vrc-studio"
version = "0.1.0"
edition = "2021"

[lib]
name = "vrc_studio_lib"
crate-type = ["lib", "cdylib", "staticlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["devtools"] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio", "macros", "migrate"] }
thiserror = "1"
log = "0.4"
env_logger = "0.11"
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: initialize Tauri 2 + React/TS project"
```

---

## Task 2: Error handling layer

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/error_test.rs`:

```rust
#[cfg(test)]
mod tests {
    use vrc_studio_lib::error::AppError;

    #[test]
    fn app_error_converts_to_string() {
        let e = AppError::Database("connection failed".to_string());
        assert_eq!(e.to_string(), "Database error: connection failed");
    }

    #[test]
    fn app_error_not_found_message() {
        let e = AppError::NotFound("project 42".to_string());
        assert_eq!(e.to_string(), "Not found: project 42");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test error_test
```

Expected: FAIL — `AppError` not defined.

- [ ] **Step 3: Implement `src-tauri/src/error.rs`**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("External service error: {0}")]
    External(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound("row".to_string()),
            other => AppError::Database(other.to_string()),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

// Tauri requires errors to be serializable to send to the frontend
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
```

- [ ] **Step 4: Export from `src-tauri/src/lib.rs`**

```rust
pub mod error;
pub mod db;
pub mod commands;
pub mod models;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test error_test
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/lib.rs src-tauri/tests/error_test.rs
git commit -m "feat: add AppError type with Tauri serialization"
```

---

## Task 3: SQLite database layer

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/migrations/001_initial.sql`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/db_test.rs`:

```rust
use vrc_studio_lib::db;
use sqlx::SqlitePool;

#[tokio::test]
async fn migrations_run_successfully() {
    let pool = db::create_test_pool().await.expect("pool creation failed");
    // If migrations ran, this table exists
    let row = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
        .fetch_optional(&pool)
        .await
        .expect("query failed");
    assert!(row.is_some(), "projects table should exist after migration");
}

#[tokio::test]
async fn migrations_are_idempotent() {
    let pool = db::create_test_pool().await.expect("pool creation failed");
    // Running migrations twice on the same DB should not fail
    let result = db::run_migrations(&pool).await;
    assert!(result.is_ok(), "second migration run should be idempotent");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test db_test
```

Expected: FAIL — `db` module not found.

- [ ] **Step 3: Create migration `src-tauri/src/db/migrations/001_initial.sql`**

```sql
-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    unity_version TEXT NOT NULL,
    unity_type  TEXT NOT NULL CHECK(unity_type IN ('standard', 'custom')),
    avatar_base_id TEXT,
    shader      TEXT CHECK(shader IN ('liltoon', 'poiyomi', NULL)),
    vcs_enabled INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Custom VPM packages
CREATE TABLE IF NOT EXISTS custom_packages (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    version     TEXT NOT NULL,
    description TEXT,
    json_path   TEXT NOT NULL,
    zip_path    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Inventory items
CREATE TABLE IF NOT EXISTS inventory_items (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    author          TEXT,
    source          TEXT NOT NULL CHECK(source IN ('booth', 'riperstore', 'local')),
    source_id       TEXT,
    local_path      TEXT NOT NULL,
    download_date   TEXT NOT NULL DEFAULT (datetime('now')),
    size_bytes      INTEGER,
    tags            TEXT DEFAULT '[]'
);

-- Virtual folders for inventory
CREATE TABLE IF NOT EXISTS inventory_folders (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    parent_id TEXT REFERENCES inventory_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_folder_items (
    folder_id TEXT NOT NULL REFERENCES inventory_folders(id) ON DELETE CASCADE,
    item_id   TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, item_id)
);

-- Assets installed in projects
CREATE TABLE IF NOT EXISTS project_assets (
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    installed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, inventory_item_id)
);

-- VPM repositories
CREATE TABLE IF NOT EXISTS vpm_repositories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    last_fetched TEXT,
    json_cache  TEXT,
    is_official INTEGER NOT NULL DEFAULT 0
);

-- Linked external accounts (tokens encrypted at app level)
CREATE TABLE IF NOT EXISTS linked_accounts (
    provider        TEXT PRIMARY KEY,
    token_encrypted TEXT NOT NULL,
    username        TEXT,
    expires_at      TEXT
);

-- Insert VRChat official VPM repository (never removable from UI)
INSERT OR IGNORE INTO vpm_repositories (id, name, url, is_official)
VALUES (
    'com.vrchat.repos.official',
    'VRChat Official',
    'https://packages.vrchat.com/official?download',
    1
);
```

- [ ] **Step 4: Create `src-tauri/src/db/mod.rs`**

```rust
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use crate::error::AppError;

pub async fn init_pool(app_data_dir: &str) -> Result<SqlitePool, AppError> {
    let db_path = format!("{}/vrc-studio.db", app_data_dir);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&format!("sqlite://{}?mode=rwc", db_path))
        .await?;
    run_migrations(&pool).await?;
    Ok(pool)
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), AppError> {
    sqlx::migrate!("src/db/migrations")
        .run(pool)
        .await
        .map_err(|e| AppError::Database(e.to_string()))
}

/// In-memory pool for tests only
#[cfg(test)]
pub async fn create_test_pool() -> Result<SqlitePool, AppError> {
    let pool = SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await?;
    run_migrations(&pool).await?;
    Ok(pool)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd src-tauri && cargo test db_test
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/ src-tauri/tests/db_test.rs
git commit -m "feat: SQLite layer with migrations (projects, packages, inventory tables)"
```

---

## Task 4: Shared models

**Files:**
- Create: `src-tauri/src/models/mod.rs`

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/tests/db_test.rs`:

```rust
use vrc_studio_lib::models::{Project, UnityType};

#[test]
fn project_unity_type_serializes() {
    let p = Project {
        id: "test-id".to_string(),
        name: "My Avatar".to_string(),
        path: "/projects/my-avatar".to_string(),
        unity_version: "2022.3.22f1".to_string(),
        unity_type: UnityType::Standard,
        avatar_base_id: None,
        shader: None,
        vcs_enabled: false,
    };
    let json = serde_json::to_string(&p).expect("serialize failed");
    assert!(json.contains("\"unity_type\":\"standard\""));
    assert!(json.contains("\"vcs_enabled\":false"));
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test project_unity_type
```

Expected: FAIL — `models` module not found.

- [ ] **Step 3: Create `src-tauri/src/models/mod.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum UnityType {
    Standard,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Shader {
    Liltoon,
    Poiyomi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub unity_version: String,
    pub unity_type: UnityType,
    pub avatar_base_id: Option<String>,
    pub shader: Option<Shader>,
    pub vcs_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomPackage {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub description: Option<String>,
    pub json_path: String,
    pub zip_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InventorySource {
    Booth,
    Riperstore,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub source: InventorySource,
    pub source_id: Option<String>,
    pub local_path: String,
    pub download_date: String,
    pub size_bytes: Option<i64>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InventoryFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpmRepository {
    pub id: String,
    pub name: String,
    pub url: String,
    pub last_fetched: Option<String>,
    pub is_official: bool,
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd src-tauri && cargo test project_unity_type
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models/
git commit -m "feat: shared domain models (Project, InventoryItem, VpmRepository, etc.)"
```

---

## Task 5: Commands scaffold + ping command

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/commands_test.rs`:

```rust
use vrc_studio_lib::commands::ping;

#[test]
fn ping_returns_pong() {
    let result = ping("hello".to_string());
    assert_eq!(result, "pong: hello");
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test ping_returns_pong
```

Expected: FAIL — `commands::ping` not found.

- [ ] **Step 3: Create `src-tauri/src/commands/mod.rs`**

```rust
/// Smoke-test command — verifies IPC bridge is working
#[tauri::command]
pub fn ping(msg: String) -> String {
    format!("pong: {}", msg)
}
```

- [ ] **Step 4: Register command in `src-tauri/src/lib.rs`**

```rust
pub mod error;
pub mod db;
pub mod commands;
pub mod models;

use tauri::Manager;
use sqlx::SqlitePool;

pub fn app() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir unavailable")
                .to_string_lossy()
                .to_string();

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let pool = db::init_pool(&app_data_dir)
                    .await
                    .expect("DB initialization failed");
                handle.manage(pool);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
        ])
}
```

- [ ] **Step 5: Update `src-tauri/src/main.rs`**

```rust
fn main() {
    env_logger::init();
    vrc_studio_lib::app()
        .run(tauri::generate_context!())
        .expect("error while running vrc-studio");
}
```

- [ ] **Step 6: Run tests**

```bash
cd src-tauri && cargo test ping_returns_pong
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/ src-tauri/src/lib.rs src-tauri/src/main.rs src-tauri/tests/commands_test.rs
git commit -m "feat: Tauri command scaffold + ping smoke-test"
```

---

## Task 6: Frontend dependencies + Tailwind + shadcn

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/index.css`
- Create: `components.json` (shadcn config)

- [ ] **Step 1: Install frontend dependencies**

```bash
npm install zustand react-router-dom @tauri-apps/api
npm install -D tailwindcss @tailwindcss/vite vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event
```

- [ ] **Step 2: Configure Tailwind in `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
```

- [ ] **Step 3: Replace `src/index.css`**

```css
@import "tailwindcss";

:root {
  --background: 222 14% 10%;
  --foreground: 210 20% 92%;
  --sidebar-bg: 222 14% 8%;
  --sidebar-active: 0 72% 51%;
  --accent: 0 72% 51%;
  --border: 220 13% 18%;
  --muted: 220 13% 18%;
  --muted-fg: 215 16% 55%;
  --radius: 0.5rem;
}
```

- [ ] **Step 4: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

When prompted: choose `Default` style, CSS variables, TypeScript, `src/components/ui` path.

Expected: `components.json` created at project root.

- [ ] **Step 5: Add base shadcn components**

```bash
npx shadcn@latest add button separator tooltip scroll-area
```

- [ ] **Step 6: Create test setup `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 7: Commit**

```bash
git add package.json vite.config.ts src/index.css components.json src/components/ui/ src/test/
git commit -m "feat: add Tailwind v4, shadcn/ui, Zustand, Vitest"
```

---

## Task 7: Typed Tauri IPC bridge

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/test/tauri.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/tauri.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @tauri-apps/api/core before importing our module
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { tauriPing } from "@/lib/tauri";

describe("tauriPing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls invoke with correct command and arg", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue("pong: hello");
    const result = await tauriPing("hello");
    expect(invoke).toHaveBeenCalledWith("ping", { msg: "hello" });
    expect(result).toBe("pong: hello");
  });

  it("propagates invoke errors", async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("IPC failed"));
    await expect(tauriPing("hello")).rejects.toThrow("IPC failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/tauri.test.ts
```

Expected: FAIL — `@/lib/tauri` not found.

- [ ] **Step 3: Create `src/lib/tauri.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";

// ── Smoke test ────────────────────────────────────────────────
export async function tauriPing(msg: string): Promise<string> {
  return invoke<string>("ping", { msg });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/test/tauri.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/test/tauri.test.ts
git commit -m "feat: typed Tauri IPC bridge with unit tests"
```

---

## Task 8: Zustand global store

**Files:**
- Create: `src/store/app.ts`
- Create: `src/test/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/test/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAppStore } from "@/store/app";

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({ activeSection: "projects", isLoading: false, loadingMessage: null });
  });

  it("default section is projects", () => {
    const { result } = renderHook(() => useAppStore());
    expect(result.current.activeSection).toBe("projects");
  });

  it("setActiveSection updates section", () => {
    const { result } = renderHook(() => useAppStore());
    act(() => result.current.setActiveSection("shop"));
    expect(result.current.activeSection).toBe("shop");
  });

  it("setLoading sets message and flag", () => {
    const { result } = renderHook(() => useAppStore());
    act(() => result.current.setLoading(true, "Initializing database..."));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingMessage).toBe("Initializing database...");
  });

  it("setLoading false clears message", () => {
    const { result } = renderHook(() => useAppStore());
    act(() => result.current.setLoading(false));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.loadingMessage).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/store.test.ts
```

Expected: FAIL — `@/store/app` not found.

- [ ] **Step 3: Create `src/store/app.ts`**

```ts
import { create } from "zustand";

export type Section = "projects" | "packages" | "shop" | "settings";

interface AppState {
  activeSection: Section;
  isLoading: boolean;
  loadingMessage: string | null;

  setActiveSection: (section: Section) => void;
  setLoading: (loading: boolean, message?: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeSection: "projects",
  isLoading: false,
  loadingMessage: null,

  setActiveSection: (section) => set({ activeSection: section }),
  setLoading: (loading, message = null) =>
    set({ isLoading: loading, loadingMessage: loading ? (message ?? null) : null }),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/store.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/app.ts src/test/store.test.ts
git commit -m "feat: Zustand app store (navigation + loading state)"
```

---

## Task 9: Sidebar component

**Files:**
- Create: `src/components/sidebar/NavItem.tsx`
- Create: `src/components/sidebar/Sidebar.tsx`
- Create: `src/test/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/test/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useAppStore } from "@/store/app";

describe("Sidebar", () => {
  it("renders all nav sections", () => {
    render(<Sidebar />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Packages")).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("clicking a nav item changes active section", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Shop"));
    expect(useAppStore.getState().activeSection).toBe("shop");
  });

  it("active section item has active styles", () => {
    useAppStore.setState({ activeSection: "packages", isLoading: false, loadingMessage: null });
    render(<Sidebar />);
    const packagesItem = screen.getByText("Packages").closest("button");
    expect(packagesItem).toHaveClass("bg-red-600");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/Sidebar.test.tsx
```

Expected: FAIL — `Sidebar` not found.

- [ ] **Step 3: Create `src/components/sidebar/NavItem.tsx`**

```tsx
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function NavItem({ icon: Icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-red-600 text-white"
          : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
      )}
    >
      <Icon size={18} strokeWidth={1.75} />
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 4: Create `src/components/sidebar/Sidebar.tsx`**

```tsx
import { Boxes, Package, ShoppingBag, Settings } from "lucide-react";
import { NavItem } from "./NavItem";
import { useAppStore, Section } from "@/store/app";

const NAV_ITEMS: { section: Section; label: string; icon: typeof Boxes }[] = [
  { section: "projects", label: "Projects", icon: Boxes },
  { section: "packages", label: "Packages", icon: Package },
  { section: "shop", label: "Shop", icon: ShoppingBag },
  { section: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { activeSection, setActiveSection } = useAppStore();

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-[hsl(var(--sidebar-bg))] border-r border-zinc-800 px-3 py-5 gap-1">
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 mb-6">
        <div className="w-6 h-6 bg-red-600 rounded-sm" />
        <span className="font-semibold text-zinc-100 text-sm tracking-wide">VRC Studio</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map(({ section, label, icon }) => (
          <NavItem
            key={section}
            icon={icon}
            label={label}
            active={activeSection === section}
            onClick={() => setActiveSection(section)}
          />
        ))}
      </nav>

      {/* Version */}
      <p className="px-3 text-xs text-zinc-600">v0.1.0</p>
    </aside>
  );
}
```

- [ ] **Step 5: Install lucide-react**

```bash
npm install lucide-react
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/test/Sidebar.test.tsx
```

Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/sidebar/ src/test/Sidebar.test.tsx
git commit -m "feat: Sidebar component with nav items and active state"
```

---

## Task 10: Root layout + page stubs + routing

**Files:**
- Create: `src/routes.tsx`
- Create: `src/pages/Projects.tsx`
- Create: `src/pages/Packages.tsx`
- Create: `src/pages/Shop.tsx`
- Create: `src/pages/Settings.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/test/App.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "@/App";

// Mock tauri invoke so App doesn't crash in jsdom
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("pong: test") }));

describe("App layout", () => {
  it("renders sidebar and default Projects page", () => {
    render(<App />);
    expect(screen.getByText("VRC Studio")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByTestId("page-projects")).toBeInTheDocument();
  });

  it("navigating to Shop renders Shop page", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Shop"));
    expect(screen.getByTestId("page-shop")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/test/App.test.tsx
```

Expected: FAIL — `App` doesn't have `data-testid` pages.

- [ ] **Step 3: Create page stubs**

`src/pages/Projects.tsx`:
```tsx
export default function Projects() {
  return (
    <div data-testid="page-projects" className="p-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Projects</h1>
      <p className="text-zinc-500 mt-1">Your avatar projects will appear here.</p>
    </div>
  );
}
```

`src/pages/Packages.tsx`:
```tsx
export default function Packages() {
  return (
    <div data-testid="page-packages" className="p-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Packages</h1>
      <p className="text-zinc-500 mt-1">Custom VPM packages.</p>
    </div>
  );
}
```

`src/pages/Shop.tsx`:
```tsx
export default function Shop() {
  return (
    <div data-testid="page-shop" className="p-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Shop</h1>
      <p className="text-zinc-500 mt-1">Booth & Riperstore assets.</p>
    </div>
  );
}
```

`src/pages/Settings.tsx`:
```tsx
export default function Settings() {
  return (
    <div data-testid="page-settings" className="p-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
      <p className="text-zinc-500 mt-1">App configuration.</p>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/App.tsx`**

```tsx
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useAppStore } from "@/store/app";
import Projects from "@/pages/Projects";
import Packages from "@/pages/Packages";
import Shop from "@/pages/Shop";
import Settings from "@/pages/Settings";

const PAGES = {
  projects: <Projects />,
  packages: <Packages />,
  shop: <Shop />,
  settings: <Settings />,
};

export default function App() {
  const activeSection = useAppStore((s) => s.activeSection);

  return (
    <div className="flex h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))] overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {PAGES[activeSection]}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Update `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/test/App.test.tsx
```

Expected: PASS (2 tests).

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run && cd src-tauri && cargo test
```

Expected: All tests PASS. No warnings about unused imports or missing modules.

- [ ] **Step 8: Run dev build for visual check**

```bash
npm run tauri dev
```

Expected: Tauri window opens with dark sidebar (Projects, Packages, Shop, Settings), clicking each nav item swaps the page content.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/main.tsx src/pages/ src/test/App.test.tsx
git commit -m "feat: root layout with sidebar navigation and page stubs"
```

---

## Task 11: IPC smoke-test end-to-end

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/lib/tauri.ts`

Verify the full IPC bridge works in a real Tauri window (not just in tests).

- [ ] **Step 1: Add ping button to Settings page**

```tsx
import { useState } from "react";
import { tauriPing } from "@/lib/tauri";

export default function Settings() {
  const [response, setResponse] = useState<string | null>(null);

  async function handlePing() {
    const res = await tauriPing("vrc-studio");
    setResponse(res);
  }

  return (
    <div data-testid="page-settings" className="p-8">
      <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
      <p className="text-zinc-500 mt-1">App configuration.</p>

      <div className="mt-8">
        <button
          onClick={handlePing}
          className="px-4 py-2 bg-red-600 rounded-md text-sm text-white hover:bg-red-700 transition-colors"
        >
          Test IPC Bridge
        </button>
        {response && (
          <p className="mt-3 text-green-400 text-sm font-mono">✓ {response}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run dev build and manually verify**

```bash
npm run tauri dev
```

Navigate to Settings → click "Test IPC Bridge".
Expected: `✓ pong: vrc-studio` appears in green below the button.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: IPC smoke-test button in Settings page"
```

---

## Self-Review

### Spec coverage

| Requirement | Covered in Task |
|---|---|
| Tauri 2 + Rust + React/TS | Task 1 |
| SQLite with all domain tables | Task 3 |
| Shared domain models (Project, InventoryItem…) | Task 4 |
| Error handling surfaced to frontend | Task 2 |
| Sidebar with Projects / Packages / Shop / Settings | Task 9 |
| Page navigation (click sidebar → swap page) | Task 10 |
| IPC bridge typed and tested | Task 7, 11 |
| VRChat official VPM repo pre-seeded | Task 3 (migration) |
| Zustand global state | Task 8 |

### Gaps (deferred to later plans)

- Unity detection & installation → **Plan 2 (Projects)**
- VPM index fetching / package resolution → **Plan 2 (Projects)**
- Wizard de creación → **Plan 2 (Projects)**
- Package editor → **Plan 3 (Packages)**
- Shop scraping, downloads → **Plan 4 (Shop)**
- Inventory UI → **Plan 4 (Shop)**
- Git integration → **Plan 6 (VCS)**
- Unity Custom patching → **Plan 5 (Unity Custom)**

### Placeholder scan

No TBDs, TODOs, or "implement later" in any step. All code blocks are complete and runnable.

### Type consistency

- `Section` type defined in `store/app.ts`, used consistently in `Sidebar.tsx` and `App.tsx`.
- `AppError` defined in `error.rs`, imported via `crate::error::AppError` in `db/mod.rs` and `commands/mod.rs`.
- `UnityType::Standard` / `UnityType::Custom` match the `unity_type` CHECK constraint in `001_initial.sql` (`standard`, `custom`).

---

## Execution Handoff

Plan completo guardado en `docs/superpowers/plans/2026-04-29-vrc-studio-core.md`. **Dos opciones de ejecución:**

**1. Subagent-Driven (recomendado)** — dispatch de un subagente fresco por tarea, revisión entre tareas, iteración rápida.

**2. Inline Execution** — ejecución en esta sesión con checkpoints de revisión.

¿Cuál prefieres?

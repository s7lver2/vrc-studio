# Project Creation Rework + Early Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the SplashScreenCarousel (direction C), rework the 3-step project creation wizard, and implement the Early Import system (auto-extract inventory items into a Unity project on first open) with a new Imports tab in the project detail modal.

**Architecture:** Early Import state lives in a new `project_early_imports` DB table + a `early_import_done` boolean on `projects`. The extraction runs synchronously before Unity launches inside `open_project_in_unity`, emitting `early_import_progress` Tauri events. The frontend listens via a new `EarlyImportToast` component and shows a progress toast. The wizard gains a Step 3 (inventory selector) and the project detail modal gains an `Imports` tab (read-only grid).

**Tech Stack:** Rust (Tauri 2, rusqlite, zip crate), React/TypeScript, Zustand, Tailwind CSS, lucide-react

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/components/SplashScreenCarousel.tsx` | Modify | Direction-C visual redesign + VRChat date extraction |
| `src/components/projects/wizard/CreateProjectForm.tsx` | Modify | 3-step wizard + Early Import step UI |
| `src-tauri/src/db/migrations/024_early_imports.sql` | Create | New table + ALTER TABLE projects |
| `src-tauri/src/models/mod.rs` | Modify | `EarlyImportEntry`, extend `CreateProjectRequest` |
| `src-tauri/src/commands/projects.rs` | Modify | `create_project` saves imports; `open_project_in_unity` runs extraction |
| `src/lib/tauri.ts` | Modify | New types + command wrappers |
| `src/components/projects/EarlyImportToast.tsx` | Create | Toast progress component |
| `src/components/projects/ProjectDetailModal.tsx` | Modify | New `imports` tab |
| `src/App.tsx` | Modify | Mount `<EarlyImportToast />` globally |

---

## Task 1: DB Migration — `project_early_imports` + `early_import_done`

**Files:**
- Create: `src-tauri/src/db/migrations/024_early_imports.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- src-tauri/src/db/migrations/024_early_imports.sql
CREATE TABLE IF NOT EXISTS project_early_imports (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',
  imported_at TEXT,
  error_msg   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE projects ADD COLUMN early_import_done INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 2: Register the migration in `src-tauri/src/db/mod.rs`**

Open `src-tauri/src/db/mod.rs` and find the list of migration file includes. It will look like a sequence of `include_str!("migrations/023_...")` calls. Add after the last entry:

```rust
include_str!("migrations/024_early_imports.sql"),
```

- [ ] **Step 3: Build to verify the migration compiles**

```powershell
cd src-tauri; cargo check 2>&1 | Select-String "error"
```

Expected: no `error` lines (warnings OK).

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/db/migrations/024_early_imports.sql src-tauri/src/db/mod.rs
git commit -m "feat: add project_early_imports table and early_import_done column"
```

---

## Task 2: Rust Models — `EarlyImportEntry` + extend `CreateProjectRequest`

**Files:**
- Modify: `src-tauri/src/models/mod.rs`

- [ ] **Step 1: Add `EarlyImportEntry` struct and extend `CreateProjectRequest`**

In `src-tauri/src/models/mod.rs`, find `pub struct CreateProjectRequest` and add the new field:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub destination_dir: String,
    pub unity_version: String,
    pub unity_path: String,
    pub unity_type: UnityType,
    pub avatar_base_id: Option<String>,
    pub shader: Option<Shader>,
    pub vcs_enabled: bool,
    pub vpm_packages: Vec<String>,
    #[serde(default)]
    pub custom_package_ids: Vec<String>,
    /// IDs of inventory items to auto-extract on first Unity open.
    #[serde(default)]
    pub early_import_item_ids: Vec<String>,
}
```

Then add after `CreateProjectProgress` (anywhere after the projects section):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarlyImportEntry {
    pub id: String,
    pub project_id: String,
    pub item_id: String,
    pub item_name: String,
    pub thumbnail_url: Option<String>,
    pub local_path: String,
    pub status: String, // "pending" | "done" | "error"
    pub imported_at: Option<String>,
    pub error_msg: Option<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EarlyImportProgressEvent {
    pub project_id: String,
    pub item_id: String,
    pub item_name: String,
    pub current: usize,
    pub total: usize,
    pub status: String, // "extracting" | "done" | "error" | "complete"
    pub error: Option<String>,
}
```

- [ ] **Step 2: Verify compile**

```powershell
cd src-tauri; cargo check 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```powershell
git add src-tauri/src/models/mod.rs
git commit -m "feat: add EarlyImportEntry model and early_import_item_ids to CreateProjectRequest"
```

---

## Task 3: Rust Commands — `create_project` saves early imports + `get_project_early_imports`

**Files:**
- Modify: `src-tauri/src/commands/projects.rs`

- [ ] **Step 1: In `create_project`, insert early import rows after the project INSERT**

Find the block in `create_project` that contains:
```rust
    conn.execute(
        "INSERT INTO projects (id, name, path, unity_version, unity_type, avatar_base_id, shader, vcs_enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
```

Right after the `conn.execute(...)` call (before the `emit(1.0, ...)` line), add:

```rust
    // Insert early import rows if any were selected
    if !request.early_import_item_ids.is_empty() {
        // Mark project as needing first-open import
        conn.execute(
            "UPDATE projects SET early_import_done = 0 WHERE id = ?1",
            params![project_id],
        )?;
        for (idx, item_id) in request.early_import_item_ids.iter().enumerate() {
            let entry_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO project_early_imports (id, project_id, item_id, status, sort_order)
                 VALUES (?1, ?2, ?3, 'pending', ?4)",
                params![entry_id, project_id, item_id, idx as i64],
            )?;
        }
    }
```

- [ ] **Step 2: Add `get_project_early_imports` command**

At the end of the file (before the closing of the module, near other `#[tauri::command]` functions), add:

```rust
#[tauri::command]
pub async fn get_project_early_imports(
    project_id: String,
    pool: State<'_, DbPool>,
) -> Result<Vec<crate::models::EarlyImportEntry>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT
           pei.id, pei.project_id, pei.item_id,
           COALESCE(ii.display_name, ii.name) AS item_name,
           ii.thumbnail_url,
           ii.local_path,
           pei.status, pei.imported_at, pei.error_msg, pei.sort_order
         FROM project_early_imports pei
         JOIN inventory_items ii ON ii.id = pei.item_id
         WHERE pei.project_id = ?1
         ORDER BY pei.sort_order ASC",
    )?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok(crate::models::EarlyImportEntry {
            id:          row.get(0)?,
            project_id:  row.get(1)?,
            item_id:     row.get(2)?,
            item_name:   row.get(3)?,
            thumbnail_url: row.get(4)?,
            local_path:  row.get(5)?,
            status:      row.get(6)?,
            imported_at: row.get(7)?,
            error_msg:   row.get(8)?,
            sort_order:  row.get(9)?,
        })
    })?;
    let mut entries = Vec::new();
    for row in rows { entries.push(row?); }
    Ok(entries)
}
```

- [ ] **Step 3: Register the new command in `src-tauri/src/lib.rs`**

Find the `.invoke_handler(tauri::generate_handler![` block. Locate the projects section and add after the last projects command:

```rust
crate::commands::projects::get_project_early_imports,
```

- [ ] **Step 4: Verify compile**

```powershell
cd src-tauri; cargo check 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add src-tauri/src/commands/projects.rs src-tauri/src/lib.rs
git commit -m "feat: save early imports in create_project and add get_project_early_imports command"
```

---

## Task 4: Rust — Early Import extraction in `open_project_in_unity`

**Files:**
- Modify: `src-tauri/src/commands/projects.rs`

- [ ] **Step 1: Add helper functions before `open_project_in_unity`**

Find a good location near the top of `projects.rs` (after the use imports, before the first `pub async fn`). Add both helpers:

```rust
fn sanitize_dir_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '_' || c == '-' { c } else { '_' })
        .collect::<String>()
        .trim()
        .to_string()
}

fn extract_archive_for_early_import(archive: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let ext = archive
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext == "zip" {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut a = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        a.extract(dest).map_err(|e| e.to_string())?;
    } else if ext == "unitypackage" {
        crate::services::downloader::extract_unitypackage_to_dir(archive, dest)
            .map_err(|e| e.to_string())?;
    } else {
        return Err(format!("Unsupported archive format: {ext}"));
    }
    Ok(())
}
```

- [ ] **Step 2: Replace `open_project_in_unity` with the early-import-aware version**

Find the entire `pub async fn open_project_in_unity` function (from `pub async fn open_project_in_unity` to its closing `}`) and replace it with:

```rust
#[tauri::command]
pub async fn open_project_in_unity(
    project_id: String,
    project_path: String,
    unity_path: String,
    app: AppHandle,
    pool: State<'_, DbPool>,
) -> Result<(), AppError> {
    // ── Early Import: run on first open ─────────────────────────────
    let needs_import: bool = {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT early_import_done FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(1) == 0
    };

    if needs_import {
        // Load pending items
        let items: Vec<(String, String, String, String, i64)> = {
            let conn = pool.get()?;
            let mut stmt = conn.prepare(
                "SELECT pei.id, pei.item_id, COALESCE(ii.display_name, ii.name), ii.local_path, pei.sort_order
                 FROM project_early_imports pei
                 JOIN inventory_items ii ON ii.id = pei.item_id
                 WHERE pei.project_id = ?1 AND pei.status = 'pending'
                 ORDER BY pei.sort_order ASC",
            )?;
            let rows = stmt.query_map(params![project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,  // entry id
                    row.get::<_, String>(1)?,  // item_id
                    row.get::<_, String>(2)?,  // item_name
                    row.get::<_, String>(3)?,  // local_path
                    row.get::<_, i64>(4)?,     // sort_order
                ))
            })?;
            let mut v = Vec::new();
            for r in rows { v.push(r?); }
            v
        };

        let total = items.len();
        let project_dir = std::path::PathBuf::from(&project_path);

        for (idx, (entry_id, item_id, item_name, local_path, _)) in items.iter().enumerate() {
            let current = idx + 1;
            // Emit extracting event
            let _ = app.emit("early_import_progress", crate::models::EarlyImportProgressEvent {
                project_id: project_id.clone(),
                item_id: item_id.clone(),
                item_name: item_name.clone(),
                current,
                total,
                status: "extracting".to_string(),
                error: None,
            });

            let archive = std::path::Path::new(local_path);
            let safe_name = sanitize_dir_name(item_name);
            let dest = project_dir.join("Assets").join("EarlyImports").join(&safe_name);

            // Security check: dest must be inside the project
            if !dest.starts_with(&project_dir) {
                let err = "Security: destination outside project directory".to_string();
                let conn = pool.get()?;
                conn.execute(
                    "UPDATE project_early_imports SET status='error', error_msg=?1, imported_at=datetime('now') WHERE id=?2",
                    params![err, entry_id],
                )?;
                let _ = app.emit("early_import_progress", crate::models::EarlyImportProgressEvent {
                    project_id: project_id.clone(),
                    item_id: item_id.clone(),
                    item_name: item_name.clone(),
                    current, total,
                    status: "error".to_string(),
                    error: Some(err),
                });
                continue;
            }

            if let Err(e) = std::fs::create_dir_all(&dest) {
                let err = format!("Cannot create directory: {e}");
                let conn = pool.get()?;
                conn.execute(
                    "UPDATE project_early_imports SET status='error', error_msg=?1, imported_at=datetime('now') WHERE id=?2",
                    params![err, entry_id],
                )?;
                let _ = app.emit("early_import_progress", crate::models::EarlyImportProgressEvent {
                    project_id: project_id.clone(), item_id: item_id.clone(),
                    item_name: item_name.clone(), current, total,
                    status: "error".to_string(), error: Some(err),
                });
                continue;
            }

            match extract_archive_for_early_import(archive, &dest) {
                Ok(_) => {
                    let conn = pool.get()?;
                    conn.execute(
                        "UPDATE project_early_imports SET status='done', imported_at=datetime('now') WHERE id=?1",
                        params![entry_id],
                    )?;
                    let _ = app.emit("early_import_progress", crate::models::EarlyImportProgressEvent {
                        project_id: project_id.clone(), item_id: item_id.clone(),
                        item_name: item_name.clone(), current, total,
                        status: "done".to_string(), error: None,
                    });
                }
                Err(e) => {
                    let conn = pool.get()?;
                    conn.execute(
                        "UPDATE project_early_imports SET status='error', error_msg=?1, imported_at=datetime('now') WHERE id=?2",
                        params![e, entry_id],
                    )?;
                    let _ = app.emit("early_import_progress", crate::models::EarlyImportProgressEvent {
                        project_id: project_id.clone(), item_id: item_id.clone(),
                        item_name: item_name.clone(), current, total,
                        status: "error".to_string(), error: Some(e),
                    });
                }
            }
        }

        // Mark project as done regardless of individual item errors
        let conn = pool.get()?;
        conn.execute(
            "UPDATE projects SET early_import_done = 1 WHERE id = ?1",
            params![project_id],
        )?;

        // Emit completion event
        let _ = app.emit("early_import_progress", crate::models::EarlyImportProgressEvent {
            project_id: project_id.clone(),
            item_id: String::new(),
            item_name: String::new(),
            current: total,
            total,
            status: "complete".to_string(),
            error: None,
        });
    }

    // ── Launch Unity ─────────────────────────────────────────────────
    tokio::process::Command::new(&unity_path)
        .arg("-projectPath")
        .arg(&project_path)
        .spawn()
        .map_err(|e| AppError::Io(format!("Failed to launch Unity: {e}")))?;

    // Schedule screenshot 30s after launch
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| AppError::External(e.to_string()))?;
    let pool_clone = pool.inner().clone();
    let app_clone = app.clone();
    let pid = project_id.clone();
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        if let Ok(png_path) = capture_screen_to_file(&data_dir, &pid) {
            let conn = match pool_clone.get() {
                Ok(c) => c,
                Err(e) => { eprintln!("Screenshot DB error: {e}"); return; }
            };
            let _ = conn.execute(
                "UPDATE projects SET last_screenshot = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![png_path, pid],
            );
            let _ = app_clone.emit("project:screenshot_ready", &pid);
        }
    });

    Ok(())
}
```

- [ ] **Step 3: Verify compile**

```powershell
cd src-tauri; cargo check 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add src-tauri/src/commands/projects.rs
git commit -m "feat: run early import extraction in open_project_in_unity on first open"
```

---

## Task 5: Frontend Types + Command Wrappers in `tauri.ts`

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add new types and extend `CreateProjectRequest`**

Find `export interface CreateProjectRequest` in `src/lib/tauri.ts` and add the new field:

```typescript
export interface CreateProjectRequest {
  name: string;
  destination_dir: string;
  unity_version: string;
  unity_path: string;
  unity_type: "standard" | "custom";
  avatar_base_id: string | null;
  shader: "liltoon" | "poiyomi" | null;
  vcs_enabled: boolean;
  vpm_packages: string[];
  custom_package_ids: string[];
  early_import_item_ids: string[];  // NEW
}
```

Then add these new interfaces near the Projects section (after `CreateProjectProgress`):

```typescript
export interface EarlyImportEntry {
  id: string;
  project_id: string;
  item_id: string;
  item_name: string;
  thumbnail_url: string | null;
  local_path: string;
  status: "pending" | "done" | "error";
  imported_at: string | null;
  error_msg: string | null;
  sort_order: number;
}

export interface EarlyImportProgressEvent {
  project_id: string;
  item_id: string;
  item_name: string;
  current: number;
  total: number;
  status: "extracting" | "done" | "error" | "complete";
  error: string | null;
}
```

- [ ] **Step 2: Add the new command wrapper**

Near the other project command wrappers (after `tauriOpenProjectInUnity`), add:

```typescript
export const tauriGetProjectEarlyImports = (projectId: string): Promise<EarlyImportEntry[]> =>
  invoke("get_project_early_imports", { projectId });
```

- [ ] **Step 3: TypeScript check**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add src/lib/tauri.ts
git commit -m "feat: add EarlyImportEntry types and tauriGetProjectEarlyImports wrapper"
```

---

## Task 6: `EarlyImportToast` Component

**Files:**
- Create: `src/components/projects/EarlyImportToast.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/components/projects/EarlyImportToast.tsx
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { EarlyImportProgressEvent } from "@/lib/tauri";
import { Zap, CheckCircle2, X } from "lucide-react";

interface ToastState {
  visible: boolean;
  done: boolean;
  itemName: string;
  current: number;
  total: number;
  errorCount: number;
}

const INITIAL: ToastState = {
  visible: false, done: false, itemName: "", current: 0, total: 0, errorCount: 0,
};

export function EarlyImportToast() {
  const [state, setState] = useState<ToastState>(INITIAL);
  const [dismissTimer, setDismissTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<EarlyImportProgressEvent>("early_import_progress", (ev) => {
      const p = ev.payload;
      if (p.status === "complete") {
        setState((prev) => ({ ...prev, done: true, visible: true }));
        const t = setTimeout(() => setState(INITIAL), 5000);
        setDismissTimer(t);
      } else if (p.status === "extracting") {
        setState({
          visible: true, done: false,
          itemName: p.item_name,
          current: p.current, total: p.total,
          errorCount: 0,
        });
      } else if (p.status === "error") {
        setState((prev) => ({ ...prev, errorCount: prev.errorCount + 1 }));
      }
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    setState(INITIAL);
  };

  if (!state.visible) return null;

  const progress = state.total > 0 ? (state.current / state.total) * 100 : 0;

  return (
    <div
      className="fixed bottom-5 right-5 z-[9998] w-72 rounded-2xl border border-zinc-700/60 bg-zinc-900/95 backdrop-blur-sm shadow-2xl overflow-hidden"
      style={{ animation: "slideUp 0.25s ease-out" }}
    >
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }`}</style>
      <div className="flex items-start gap-3 p-4">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${state.done ? "bg-emerald-900/40 border border-emerald-700/40" : "bg-red-900/30 border border-red-700/30"}`}>
          {state.done
            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            : <Zap className="h-4 w-4 text-red-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-zinc-100">Early Import</p>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">
            {state.done
              ? `${state.total} item${state.total !== 1 ? "s" : ""} extraído${state.total !== 1 ? "s" : ""} correctamente`
              : `Extrayendo ${state.itemName}… (${state.current} de ${state.total})`}
          </p>
          {!state.done && (
            <div className="mt-2 h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-red-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        {state.done && (
          <button onClick={dismiss} className="shrink-0 p-1 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it globally in `src/App.tsx`**

In `src/App.tsx`, add the import near the top:
```typescript
import { EarlyImportToast } from "@/components/projects/EarlyImportToast";
```

Then in the JSX `return (...)`, add `<EarlyImportToast />` at the end of the fragment, just before the closing `</>`:
```tsx
      <EarlyImportToast />
    </>
```

- [ ] **Step 3: TypeScript check**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```powershell
git add src/components/projects/EarlyImportToast.tsx src/App.tsx
git commit -m "feat: add EarlyImportToast component listening to early_import_progress events"
```

---

## Task 7: `SplashScreenCarousel` — Direction C Redesign

**Files:**
- Modify: `src/components/SplashScreenCarousel.tsx`

- [ ] **Step 1: Add `parseDateFromVrchatFilename` helper and `resolveDisplayMeta`**

At the top of the file, after the imports and before the `Props` interface, add:

```typescript
/** Extracts date and time from a VRChat screenshot filename.
 *  Format: VRChat_YYYY-MM-DD_HH-MM-SS.mmm_WxH.png
 *  Returns null if the filename doesn't match. */
function parseDateFromVrchatFilename(path: string): { date: string; time: string } | null {
  const filename = path.split(/[\\/]/).pop() ?? "";
  const m = filename.match(/VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, year, month, day, hh, mm, ss] = m;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { date, time: `${hh}:${mm}:${ss}` };
}

interface DisplayMeta {
  titleLine: string;
  subtitleLine: string | null;
}

function resolveDisplayMeta(entry: CarouselImageEntry): DisplayMeta {
  if (entry.builtInId) {
    const meta = getSplashImageById(entry.builtInId);
    return {
      titleLine: meta?.title ?? "",
      subtitleLine: meta ? `Photo by ${meta.artist}` : null,
    };
  }
  if (entry.path) {
    const parsed = parseDateFromVrchatFilename(entry.path);
    if (parsed) return { titleLine: parsed.date, subtitleLine: `${parsed.time} · VRChat` };
    const filename = entry.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
    return { titleLine: filename, subtitleLine: null };
  }
  return { titleLine: "", subtitleLine: null };
}
```

- [ ] **Step 2: Replace the full JSX return in `SplashScreenCarousel`**

The component's `return (...)` currently has a background image, a photo credit section, and a right-side panel. Replace the entire `return (...)` block with:

```tsx
  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden select-none"
      style={{
        opacity: exiting ? 0 : 1,
        transition: exiting ? "opacity 0.5s ease-in" : "opacity 0.3s ease-out",
        pointerEvents: exiting ? "none" : "all",
        background: "#09090b",
      }}
    >
      {/* Background image */}
      {imageUrl && (
        <div
          className="absolute inset-0"
          style={{
            opacity: visible && imgVisible ? 1 : 0,
            transition: imgVisible ? "opacity 0.5s ease-in" : "opacity 0.5s ease-out",
          }}
        >
          <img src={imageUrl} alt="" className="w-full h-full object-cover" draggable={false} />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,.65) 0%, rgba(0,0,0,.1) 55%, rgba(0,0,0,.05) 100%)," +
                "linear-gradient(to bottom, transparent 35%, rgba(0,0,0,.92) 100%)",
            }}
          />
        </div>
      )}

      {/* Bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-4 px-8 pb-8"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(14px)",
          transition: "opacity 0.45s ease-out 0.1s, transform 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.1s",
        }}
      >
        {/* Left: title + subtitle + bar + dots */}
        <div className="flex flex-col gap-2 min-w-0">
          {displayMeta.titleLine && (
            <p
              style={{
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: "#ffffff",
                fontFamily: "system-ui, -apple-system, sans-serif",
                textShadow: "0 2px 12px rgba(0,0,0,0.5)",
              }}
            >
              {displayMeta.titleLine}
            </p>
          )}
          {displayMeta.subtitleLine && (
            <p
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.5)",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              {displayMeta.subtitleLine}
            </p>
          )}
          {/* Progress bar */}
          <div className="flex items-center gap-8 mt-1">
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ width: 100, height: 2, borderRadius: 99, background: "rgba(255,255,255,.18)", overflow: "hidden", position: "relative" }}>
                <div style={{ position: "absolute", inset: 0, width: `${progress}%`, borderRadius: 99, background: "#fff", transition: "width 0.35s ease-out" }} />
              </div>
              <p style={{ fontSize: 7, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,.3)", fontFamily: "system-ui" }}>
                Loading…
              </p>
            </div>
            {/* Slideshow dots */}
            {imageList.length > 1 && (
              <div className="flex items-center gap-1">
                {imageList.slice(0, 8).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: 3,
                      borderRadius: 99,
                      background: i === activeIdx ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.28)",
                      width: i === activeIdx ? 14 : 4,
                      transition: "width 0.3s ease, background 0.3s ease",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, textAlign: "right" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", fontFamily: "system-ui" }}>VRC</span>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "-0.02em", color: "rgba(255,255,255,.55)", fontFamily: "system-ui" }}>Studio</span>
          </div>
          <img
            src="/logo-mark-256.png"
            alt="VRC Studio"
            style={{ width: 28, height: 28, objectFit: "contain", filter: "brightness(0) invert(1)" }}
          />
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 3: Add `displayMeta` computation in the component body** (before the `return`)

Find the line `const meta = resolveMeta(activeEntry);` (or wherever `activeEntry` and `imageUrl` are resolved) and add after it:

```typescript
  const displayMeta = resolveDisplayMeta(activeEntry);
```

Remove the old `meta` and `isBuiltIn` variables if they are no longer used by the new JSX.

- [ ] **Step 4: TypeScript check**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```powershell
git add src/components/SplashScreenCarousel.tsx
git commit -m "feat: redesign SplashScreenCarousel direction C with date extraction and slideshow dots"
```

---

## Task 8: Wizard Step Indicator Refactor + Step 3 — Early Import

**Files:**
- Modify: `src/components/projects/wizard/CreateProjectForm.tsx`

This is the largest frontend task. The wizard currently has 2 steps controlled by a `step` state (`1 | 2`). We extend it to `1 | 2 | 3`.

- [ ] **Step 1: Replace `StepIndicator` component**

Find `function StepIndicator({ step }: { step: 1 | 2 })` and replace it entirely with:

```typescript
function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps: { num: 1 | 2 | 3; label: string }[] = [
    { num: 1, label: "Setup" },
    { num: 2, label: "Paquetes" },
    { num: 3, label: "Early Import" },
  ];
  return (
    <div className="flex items-center gap-0 select-none px-6 pt-4">
      {steps.map((s, i) => {
        const isDone = step > s.num;
        const isActive = step === s.num;
        return (
          <div key={s.num} className="flex items-center" style={{ flex: i < steps.length - 1 ? 1 : 0 }}>
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{
                  background: isDone ? "#16a34a" : isActive ? "#dc2626" : "#27272a",
                  color: isDone || isActive ? "#fff" : "#52525b",
                }}
              >
                {isDone ? "✓" : s.num}
              </div>
              <span
                className="text-[10px]"
                style={{ color: isActive ? "#f4f4f5" : isDone ? "#71717a" : "#52525b", fontWeight: isActive ? 600 : 400 }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex-1 mx-2 h-px bg-zinc-800" style={{ minWidth: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add `EarlyImportStep` component**

Add this new component after `StepIndicator` and before the main `CreateProjectForm` function:

```typescript
interface EarlyImportStepProps {
  selectedIds: string[];
  onToggle: (id: string) => void;
}

function EarlyImportStep({ selectedIds, onToggle }: EarlyImportStepProps) {
  const [items, setItems] = useState<import("@/lib/tauri").InventoryItem[]>([]);
  const [filter, setFilter] = useState("");
  const t = useT();

  useEffect(() => {
    tauriListInventory().then(setItems).catch(() => {});
  }, []);

  const filtered = items.filter((item) => {
    const label = item.display_name ?? item.name;
    return label.toLowerCase().includes(filter.toLowerCase()) ||
      (item.author?.toLowerCase().includes(filter.toLowerCase()) ?? false);
  });

  const coverFor = (item: import("@/lib/tauri").InventoryItem) => {
    if (item.custom_cover_path) return toAssetUrl(item.custom_cover_path);
    if (item.thumbnail_url) return item.thumbnail_url;
    if (item.product_images.length > 0) {
      const p = item.product_images[0];
      return p.startsWith("http") ? p : (toAssetUrl(p) ?? null);
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Info banner */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 leading-relaxed">
        <span className="text-yellow-400 mt-0.5">⚡</span>
        <span>Los items seleccionados se extraerán automáticamente en Unity la primera vez que abras el proyecto, uno a uno, sin confirmación.</span>
      </div>
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
        <Search className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
        <input
          className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
          placeholder="Buscar en inventario…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-6">
          {items.length === 0 ? "Tu inventario está vacío" : "Sin resultados"}
        </p>
      ) : (
        <div className="grid grid-cols-5 gap-2 max-h-52 overflow-y-auto pr-1">
          {filtered.map((item) => {
            const label = item.display_name ?? item.name;
            const selected = selectedIds.includes(item.id);
            const cover = coverFor(item);
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id)}
                className="flex flex-col items-center gap-1 group focus:outline-none"
              >
                <div
                  className="relative w-full aspect-square rounded-xl overflow-hidden border-2 transition-all"
                  style={{ borderColor: selected ? "#dc2626" : "#27272a" }}
                >
                  {cover ? (
                    <img src={cover} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                      <Package className="h-5 w-5 text-zinc-700" />
                    </div>
                  )}
                  {selected && (
                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center">
                      <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-[9px] text-zinc-500 text-center leading-tight line-clamp-2 w-full px-0.5">
                  {label}
                </p>
              </button>
            );
          })}
        </div>
      )}
      {/* Count badge */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-950/40 border border-red-900/40 w-fit text-xs font-medium text-red-400">
          <span>⚡</span>
          <span>{selectedIds.length} item{selectedIds.length !== 1 ? "s" : ""} seleccionado{selectedIds.length !== 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Extend `CreateProjectForm` state and step flow**

In the `CreateProjectForm` function, find where `step` state is declared and update the type:

```typescript
const [step, setStep] = useState<1 | 2 | 3>(1);
const [earlyImportIds, setEarlyImportIds] = useState<string[]>([]);

const toggleEarlyImport = useCallback((id: string) => {
  setEarlyImportIds((prev) =>
    prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  );
}, []);
```

- [ ] **Step 4: Find where `step === 2` triggers `handleSubmit` and update**

The current code has a "Create" or "Next" button in step 2 that calls `handleSubmit`. Find `handleSubmit` and update it to pass `early_import_item_ids`:

Find the `request` object inside `handleSubmit` (it will have `vpm_packages`, `custom_package_ids`, etc.) and add the new field:

```typescript
  early_import_item_ids: earlyImportIds,
```

- [ ] **Step 5: Update the "Next"/"Create" button logic**

The current "Next" button in step 2 advances to creation. Change it so:
- Step 1 "Next" → go to step 2
- Step 2 "Next" → go to step 3
- Step 3 "Crear proyecto" → call `handleSubmit()`

Find the footer button(s) rendering. There will be a conditional like `{step === 2 ? <CreateButton> : <NextButton>}`. Replace the logic to handle 3 steps. The footer should render:

```tsx
{/* Step 1 footer */}
{step === 1 && (
  <>
    <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
      {t("create_project_cancel")}
    </button>
    <button
      onClick={() => setStep(2)}
      disabled={!step1Valid}
      className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {t("create_project_next")} <ChevronRight className="h-3.5 w-3.5" />
    </button>
  </>
)}
{/* Step 2 footer */}
{step === 2 && (
  <>
    <button onClick={() => setStep(1)} className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
      <ChevronLeft className="h-3.5 w-3.5" /> {t("create_project_back")}
    </button>
    <button
      onClick={() => setStep(3)}
      className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
    >
      {t("create_project_next")} <ChevronRight className="h-3.5 w-3.5" />
    </button>
  </>
)}
{/* Step 3 footer */}
{step === 3 && (
  <>
    <button onClick={() => setStep(2)} className="flex items-center gap-1.5 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
      <ChevronLeft className="h-3.5 w-3.5" /> {t("create_project_back")}
    </button>
    <div className="flex items-center gap-3">
      <button
        onClick={() => { setEarlyImportIds([]); handleSubmit(); }}
        disabled={submitting}
        className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40"
      >
        {t("create_project_skip")}
      </button>
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="flex items-center gap-1.5 rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Crear proyecto
      </button>
    </div>
  </>
)}
```

- [ ] **Step 6: Add step 3 body rendering**

Find where step 1 and step 2 content is rendered (there will be `{step === 1 && ...}` / `{step === 2 && ...}` blocks). Add:

```tsx
{step === 3 && (
  <EarlyImportStep selectedIds={earlyImportIds} onToggle={toggleEarlyImport} />
)}
```

- [ ] **Step 7: Add missing imports to `CreateProjectForm.tsx`**

Make sure these are imported at the top:
```typescript
import { tauriListInventory } from "@/lib/tauri";
import { toAssetUrl } from "@/lib/utils";
```

The `Search`, `CheckCircle2`, `Package` icons should already be in the lucide imports — add them if missing.

- [ ] **Step 8: TypeScript check**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 9: Commit**

```powershell
git add src/components/projects/wizard/CreateProjectForm.tsx
git commit -m "feat: 3-step project wizard with Early Import step"
```

---

## Task 9: `ProjectDetailModal` — Imports Tab

**Files:**
- Modify: `src/components/projects/ProjectDetailModal.tsx`

- [ ] **Step 1: Extend the `Tab` type and `TabBar`**

Find `type Tab = "overview" | "files" | "packages" | "git";` and replace with:

```typescript
type Tab = "overview" | "files" | "packages" | "git" | "imports";
```

Find the `TabBar` function. The tabs array inside it looks like:
```typescript
    { id: "overview", ... },
    { id: "files", ... },
    { id: "packages", ... },
    ...(vcsEnabled ? [{ id: "git" as Tab, ... }] : []),
```

Add the imports tab after packages:
```typescript
    { id: "overview",  label: t("project_detail_tab_overview"),  icon: Info },
    { id: "files",     label: t("project_detail_tab_files"),     icon: FileSearch },
    { id: "packages",  label: t("project_detail_tab_packages"),  icon: Package },
    { id: "imports",   label: "Imports",                          icon: Download },
    ...(vcsEnabled ? [{ id: "git" as Tab, label: t("project_detail_tab_git"), icon: GitBranch }] : []),
```

Add `Download` to the lucide-react import at the top of the file.

- [ ] **Step 2: Add `ImportsTab` component**

Add this component before `ProjectDetailModal` (the main export):

```typescript
import { tauriGetProjectEarlyImports, EarlyImportEntry } from "@/lib/tauri";

function ImportsTab({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<EarlyImportEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "done" | "pending">("all");

  useEffect(() => {
    setLoading(true);
    tauriGetProjectEarlyImports(projectId)
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  // Refresh when an early import completes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ project_id: string; status: string }>("early_import_progress", (ev) => {
      if (ev.payload.project_id === projectId && ev.payload.status === "complete") {
        tauriGetProjectEarlyImports(projectId).then(setEntries).catch(() => {});
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [projectId]);

  const statusFiltered = entries.filter((e) => {
    if (statusTab === "done") return e.status === "done";
    if (statusTab === "pending") return e.status === "pending" || e.status === "error";
    return true;
  });

  const textFiltered = statusFiltered.filter((e) =>
    e.item_name.toLowerCase().includes(filter.toLowerCase())
  );

  const doneCount    = entries.filter((e) => e.status === "done").length;
  const pendingCount = entries.filter((e) => e.status !== "done").length;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 text-zinc-600 animate-spin" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-600 py-10">
        <Package className="h-8 w-8" />
        <p className="text-sm">No hay Early Imports para este proyecto</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      {/* Filter row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
          <Search className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          <input
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
            placeholder="Filtrar…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      {/* Status tabs */}
      <div className="flex gap-1.5">
        {([
          { id: "all",     label: `Todos (${entries.length})` },
          { id: "done",    label: `✓ Importados (${doneCount})` },
          { id: "pending", label: `⏳ Pendientes (${pendingCount})` },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusTab(tab.id)}
            className="text-[10px] px-2.5 py-1 rounded-md transition-colors"
            style={statusTab === tab.id
              ? { background: "rgba(220,38,38,.1)", color: "#f87171", border: "1px solid rgba(220,38,38,.2)" }
              : { background: "#18181b", color: "#52525b", border: "1px solid #27272a" }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Grid */}
      <div className="grid grid-cols-4 gap-2.5">
        {textFiltered.map((entry) => {
          const cover = entry.thumbnail_url
            ? (entry.thumbnail_url.startsWith("http") ? entry.thumbnail_url : toAssetUrl(entry.thumbnail_url))
            : null;
          const statusColor = entry.status === "done" ? "#16a34a" : entry.status === "error" ? "#dc2626" : "#f59e0b";
          const statusIcon  = entry.status === "done" ? "✓" : entry.status === "error" ? "✕" : "⏳";
          return (
            <div key={entry.id} className="flex flex-col items-center gap-1.5">
              <div
                className="relative w-full aspect-square rounded-xl overflow-hidden border-2"
                style={{ borderColor: entry.status === "done" ? "#16a34a40" : "#27272a" }}
                title={entry.error_msg ?? undefined}
              >
                {cover ? (
                  <img src={cover} alt={entry.item_name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                    <Package className="h-5 w-5 text-zinc-700" />
                  </div>
                )}
                <div
                  className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] text-white font-bold"
                  style={{ background: statusColor }}
                >
                  {statusIcon}
                </div>
              </div>
              <p className="text-[9px] text-zinc-500 text-center leading-tight line-clamp-2 w-full px-0.5">
                {entry.item_name}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add required imports to the file**

Add to the existing lucide imports: `Search`, `Download` (if not already present).

Add to the tauri imports:
```typescript
import { tauriGetProjectEarlyImports, EarlyImportEntry } from "@/lib/tauri";
```

- [ ] **Step 4: Wire up the new tab in the modal body**

Find the section where tab bodies are rendered. It looks like:
```tsx
          <div className={tab === "overview" ? "contents" : "hidden"}>
          <div className={tab === "files" ? "contents" : "hidden"}>
          <div className={tab === "packages" ? "flex-1 flex flex-col overflow-hidden" : "hidden"}>
          <div className={tab === "git" ? ...}>
```

Add after the packages div:
```tsx
          <div className={tab === "imports" ? "flex-1 flex flex-col overflow-hidden min-h-0" : "hidden"}>
            <ImportsTab projectId={project.id} />
          </div>
```

- [ ] **Step 5: TypeScript check**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add src/components/projects/ProjectDetailModal.tsx
git commit -m "feat: add Imports tab to ProjectDetailModal with grid and status filters"
```

---

## Task 10: Final Integration Check

- [ ] **Step 1: Full Rust build**

```powershell
cd src-tauri; cargo build 2>&1 | Select-String "error\[" | Select-Object -First 20
```

Expected: no `error[...]` lines.

- [ ] **Step 2: Full TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected: no output (clean).

- [ ] **Step 3: Smoke-test in dev mode (manual)**

```powershell
npm run tauri dev
```

Verify:
1. Splash screen (carousel mode): direction-C layout visible, logo bottom-right, dots present
2. Create new project: 3 steps show correctly, step 3 shows inventory grid
3. Skipping step 3: project creates normally
4. Selecting items in step 3 + clicking "Crear proyecto": project is created, `project_early_imports` rows inserted
5. Opening the project in Unity: toast appears with progress, Unity launches after extraction
6. Project detail modal: "Imports" tab shows the grid with green checkmarks after import

- [ ] **Step 4: Final commit**

```powershell
git add -A
git commit -m "feat: complete project creation rework + early import system"
```

# Booth Dependencies System + Clone from GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a `booth-deps.toml` manifest system that tracks Booth package dependencies per Unity project (never committing assets to git, only the manifest), plus a "Clone from GitHub" flow that reads and resolves those dependencies on clone.

**Architecture:** Hybrid Rust/TypeScript. Rust handles all filesystem operations, hashing, gitignore mutation, and git clone. TypeScript (Zustand + React) manages UI state and resolution flow. New Tauri commands follow existing patterns in `src-tauri/src/commands/`.

**Tech Stack:** Rust (sha2 ✅ already in Cargo.toml, git2 ✅, walkdir ✅, serde/toml needs adding), TypeScript, React, Zustand, Tauri 2, `toml` crate (new dependency).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src-tauri/Cargo.toml` | Modify | Add `toml = "0.8"` dependency |
| `src-tauri/src/commands/booth_deps.rs` | Create | All booth-deps Tauri commands |
| `src-tauri/src/commands/mod.rs` | Modify | `pub mod booth_deps;` |
| `src-tauri/src/lib.rs` | Modify | Register all new commands in `generate_handler!` |
| `src/lib/tauri.ts` | Modify | TypeScript wrappers for new commands |
| `src/store/boothDepsStore.ts` | Create | Zustand store for deps state |
| `src/components/projects/CloneFromGithubModal.tsx` | Create | URL input + clone progress modal |
| `src/components/projects/BoothDepCard.tsx` | Create | Single dependency card in resolver |
| `src/components/projects/DependencyResolverModal.tsx` | Create | Per-dep resolution list modal |
| `src/components/projects/DependencyStatusPanel.tsx` | Create | Persistent pending-deps banner |
| `src/pages/Projects.tsx` | Modify | Add "Clone from GitHub" button + wire modals |

---

## Task 1: Add `toml` crate to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency**

Open `src-tauri/Cargo.toml`. After the `regex = "1"` line, add:

```toml
toml = "0.8"
```

- [ ] **Step 2: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors (warnings are OK).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add toml crate for booth-deps manifest"
```

---

## Task 2: Rust data types and manifest read/write helpers

**Files:**
- Create: `src-tauri/src/commands/booth_deps.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create `booth_deps.rs` with types and helpers**

Create `src-tauri/src/commands/booth_deps.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;

// ── Manifest types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoothDepEntry {
    pub source: String,
    pub source_id: String,
    pub name: String,
    pub author: String,
    pub version_hash: String,   // SHA256 of the original downloaded .zip
    pub install_path: String,   // relative to project root, e.g. "Assets/Booth/my-outfit"
    pub added_at: String,       // ISO 8601 date
    pub modified: bool,         // true when local files differ from hash snapshot
}

#[derive(Debug, Serialize, Deserialize)]
struct BoothDepsMetadata {
    vrcstudio_version: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BoothDepsManifest {
    metadata: BoothDepsMetadata,
    #[serde(default)]
    dependency: Vec<BoothDepEntry>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn manifest_path(project_path: &str) -> PathBuf {
    Path::new(project_path).join("booth-deps.toml")
}

fn read_manifest(project_path: &str) -> Result<BoothDepsManifest, String> {
    let path = manifest_path(project_path);
    if !path.exists() {
        return Ok(BoothDepsManifest {
            metadata: BoothDepsMetadata {
                vrcstudio_version: "1.0".to_string(),
                created_at: chrono::Utc::now().format("%Y-%m-%d").to_string(),
            },
            dependency: vec![],
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    toml::from_str(&raw).map_err(|e| format!("Parse error in booth-deps.toml: {e}"))
}

fn write_manifest(project_path: &str, manifest: &BoothDepsManifest) -> Result<(), String> {
    let path = manifest_path(project_path);
    let raw = toml::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Export the module**

In `src-tauri/src/commands/mod.rs`, add after the last `pub mod` line:

```rust
pub mod booth_deps;
```

- [ ] **Step 3: Verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | grep -E "error|warning: unused" | head -20
```

Expected: no `error` lines.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/booth_deps.rs src-tauri/src/commands/mod.rs
git commit -m "feat(booth-deps): add manifest types and read/write helpers"
```

---

## Task 3: `booth_deps_read` and `booth_deps_add` commands

**Files:**
- Modify: `src-tauri/src/commands/booth_deps.rs`

- [ ] **Step 1: Add `booth_deps_read` command**

Append to `booth_deps.rs`:

```rust
/// Returns all dependency entries from booth-deps.toml for a given project path.
/// Returns an empty list if the file does not exist.
#[tauri::command]
pub fn booth_deps_read(project_path: String) -> Result<Vec<BoothDepEntry>, String> {
    let manifest = read_manifest(&project_path)?;
    Ok(manifest.dependency)
}
```

- [ ] **Step 2: Add SHA256 helper and `booth_deps_add` command**

Append to `booth_deps.rs` (add `use sha2::{Digest, Sha256};` at top of file):

```rust
use sha2::{Digest, Sha256};

/// Computes the SHA256 hex digest of a file.
fn file_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

/// Adds (or updates) a Booth dependency entry in booth-deps.toml.
/// Also writes per-file hash snapshots to .vrcstudio/hashes/{source_id}.json
/// and appends install_path to .gitignore.
#[tauri::command]
pub fn booth_deps_add(
    project_path: String,
    source_id: String,
    name: String,
    author: String,
    zip_path: String,       // absolute path to the downloaded .zip file
    install_path: String,   // e.g. "Assets/Booth/my-outfit"
) -> Result<(), String> {
    // 1. Hash the zip
    let version_hash = file_sha256(Path::new(&zip_path))?;

    // 2. Build per-file snapshot
    let extracted_dir = Path::new(&project_path).join(&install_path);
    let mut file_hashes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if extracted_dir.exists() {
        for entry in walkdir::WalkDir::new(&extracted_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let rel = entry
                .path()
                .strip_prefix(&extracted_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let hash = file_sha256(entry.path()).unwrap_or_default();
            file_hashes.insert(rel, hash);
        }
    }

    // 3. Save snapshot to .vrcstudio/hashes/{source_id}.json
    let hashes_dir = Path::new(&project_path).join(".vrcstudio").join("hashes");
    fs::create_dir_all(&hashes_dir).map_err(|e| e.to_string())?;
    let snapshot_path = hashes_dir.join(format!("{}.json", source_id));
    let snapshot_json = serde_json::to_string_pretty(&file_hashes).map_err(|e| e.to_string())?;
    fs::write(&snapshot_path, snapshot_json).map_err(|e| e.to_string())?;

    // 4. Read/create manifest and upsert entry
    let mut manifest = read_manifest(&project_path)?;
    manifest.dependency.retain(|d| d.source_id != source_id);
    manifest.dependency.push(BoothDepEntry {
        source: "booth".to_string(),
        source_id: source_id.clone(),
        name,
        author,
        version_hash,
        install_path: install_path.clone(),
        added_at: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        modified: false,
    });
    write_manifest(&project_path, &manifest)?;

    // 5. Add install_path to .gitignore (idempotent)
    booth_deps_update_gitignore_impl(&project_path, &install_path, true)?;

    Ok(())
}
```

- [ ] **Step 3: Add the `use` imports at the top of booth_deps.rs**

The top of the file should have:

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use sha2::{Digest, Sha256};
use walkdir;
```

- [ ] **Step 4: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no `error` lines.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/booth_deps.rs
git commit -m "feat(booth-deps): add booth_deps_read and booth_deps_add commands"
```

---

## Task 4: `booth_deps_update_gitignore` and `booth_deps_check_modifications` commands

**Files:**
- Modify: `src-tauri/src/commands/booth_deps.rs`

- [ ] **Step 1: Add gitignore helper and command**

Append to `booth_deps.rs`:

```rust
const GITIGNORE_MARKER: &str = "# VRC Studio - Booth Dependency";

/// Internal helper: adds or removes install_path from .gitignore.
/// `add = true` → append; `add = false` → remove.
fn booth_deps_update_gitignore_impl(
    project_path: &str,
    install_path: &str,
    add: bool,
) -> Result<(), String> {
    let gitignore = Path::new(project_path).join(".gitignore");
    let existing = if gitignore.exists() {
        fs::read_to_string(&gitignore).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let marker_line = format!("{GITIGNORE_MARKER}: {install_path}");
    let ignore_line = format!("{install_path}/");

    // Remove any existing block for this install_path
    let mut lines: Vec<&str> = existing.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        if lines[i] == marker_line {
            // remove marker + the ignore line after it
            lines.remove(i);
            if i < lines.len() && lines[i] == ignore_line {
                lines.remove(i);
            }
        } else {
            i += 1;
        }
    }

    let mut result = lines.join("\n");
    if !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }

    if add {
        result.push_str(&format!("{marker_line}\n{ignore_line}\n"));
    }

    fs::write(&gitignore, result).map_err(|e| e.to_string())
}

/// Public Tauri command: add or remove install_path from .gitignore.
#[tauri::command]
pub fn booth_deps_update_gitignore(
    project_path: String,
    install_path: String,
    add: bool,
) -> Result<(), String> {
    booth_deps_update_gitignore_impl(&project_path, &install_path, add)
}
```

- [ ] **Step 2: Add `booth_deps_check_modifications` command**

Append to `booth_deps.rs`:

```rust
/// Compares current files in install_path against the saved hash snapshot.
/// For any dep where files have changed: sets modified=true in booth-deps.toml
/// and removes install_path from .gitignore (so git tracks those changes).
/// Returns the list of source_ids that were newly detected as modified.
#[tauri::command]
pub fn booth_deps_check_modifications(project_path: String) -> Result<Vec<String>, String> {
    let mut manifest = read_manifest(&project_path)?;
    let hashes_dir = Path::new(&project_path).join(".vrcstudio").join("hashes");
    let mut newly_modified: Vec<String> = vec![];

    for dep in manifest.dependency.iter_mut() {
        if dep.modified {
            continue; // already known modified
        }

        let snapshot_path = hashes_dir.join(format!("{}.json", dep.source_id));
        if !snapshot_path.exists() {
            continue; // no snapshot → treat as unmodified (conservative)
        }

        let snapshot_raw = fs::read_to_string(&snapshot_path).map_err(|e| e.to_string())?;
        let snapshot: std::collections::HashMap<String, String> =
            serde_json::from_str(&snapshot_raw).map_err(|e| e.to_string())?;

        let extracted_dir = Path::new(&project_path).join(&dep.install_path);
        if !extracted_dir.exists() {
            continue;
        }

        let mut is_modified = false;
        for entry in walkdir::WalkDir::new(&extracted_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let rel = entry
                .path()
                .strip_prefix(&extracted_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let current_hash = file_sha256(entry.path()).unwrap_or_default();
            let original_hash = snapshot.get(&rel).cloned().unwrap_or_default();

            if current_hash != original_hash {
                is_modified = true;
                break;
            }
        }

        if is_modified {
            dep.modified = true;
            newly_modified.push(dep.source_id.clone());
            // Remove from .gitignore so git tracks the modified files
            booth_deps_update_gitignore_impl(&project_path, &dep.install_path, false)?;
        }
    }

    if !newly_modified.is_empty() {
        write_manifest(&project_path, &manifest)?;
    }

    Ok(newly_modified)
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no `error` lines.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/booth_deps.rs
git commit -m "feat(booth-deps): add gitignore management and modification detection"
```

---

## Task 5: `project_clone_from_github` command

**Files:**
- Modify: `src-tauri/src/commands/booth_deps.rs`

- [ ] **Step 1: Add the clone command**

Append to `booth_deps.rs`:

```rust
/// Clones a GitHub repository to the given destination path.
/// Returns an object with `path` (cloned dir) and `has_booth_deps` (bool).
#[derive(Debug, Serialize)]
pub struct CloneResult {
    pub path: String,
    pub has_booth_deps: bool,
}

#[tauri::command]
pub async fn project_clone_from_github(
    app: tauri::AppHandle,
    url: String,
    dest: String,
) -> Result<CloneResult, String> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};

    let dest_path = Path::new(&dest);
    if dest_path.exists() {
        return Err(format!("Destination already exists: {dest}"));
    }

    let mut child = tokio::process::Command::new("git")
        .args(["clone", "--progress", &url, &dest])
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start git: {e}"))?;

    // Stream progress lines as events so the UI can display them
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app_clone.emit("booth-deps:clone-progress", &line);
            }
        });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("git clone failed — check the URL and your network connection".to_string());
    }

    let has_booth_deps = dest_path.join("booth-deps.toml").exists();

    Ok(CloneResult {
        path: dest.clone(),
        has_booth_deps,
    })
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no `error` lines.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/booth_deps.rs
git commit -m "feat(booth-deps): add project_clone_from_github command"
```

---

## Task 6: Register new commands in `lib.rs` and add TypeScript bindings

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Register commands in `lib.rs`**

In `src-tauri/src/lib.rs`, find the line `commands::collections::collection_get_item_collections,` and add the new commands immediately after it (before the closing `])`):

```rust
            // ── Booth Dependencies ──
            commands::booth_deps::booth_deps_read,
            commands::booth_deps::booth_deps_add,
            commands::booth_deps::booth_deps_update_gitignore,
            commands::booth_deps::booth_deps_check_modifications,
            commands::booth_deps::project_clone_from_github,
```

- [ ] **Step 2: Add TypeScript bindings to `src/lib/tauri.ts`**

At the end of `src/lib/tauri.ts`, append:

```typescript
// ── Booth Dependencies ──────────────────────────────────────────────────────

export interface BoothDepEntry {
  source: string;
  source_id: string;
  name: string;
  author: string;
  version_hash: string;
  install_path: string;
  added_at: string;
  modified: boolean;
}

export interface CloneResult {
  path: string;
  has_booth_deps: boolean;
}

export const tauriBoothDepsRead = (projectPath: string): Promise<BoothDepEntry[]> =>
  invoke("booth_deps_read", { projectPath });

export const tauriBoothDepsAdd = (args: {
  projectPath: string;
  sourceId: string;
  name: string;
  author: string;
  zipPath: string;
  installPath: string;
}): Promise<void> =>
  invoke("booth_deps_add", {
    projectPath: args.projectPath,
    sourceId: args.sourceId,
    name: args.name,
    author: args.author,
    zipPath: args.zipPath,
    installPath: args.installPath,
  });

export const tauriBoothDepsUpdateGitignore = (args: {
  projectPath: string;
  installPath: string;
  add: boolean;
}): Promise<void> =>
  invoke("booth_deps_update_gitignore", args);

export const tauriBoothDepsCheckModifications = (projectPath: string): Promise<string[]> =>
  invoke("booth_deps_check_modifications", { projectPath });

export const tauriProjectCloneFromGithub = (args: {
  url: string;
  dest: string;
}): Promise<CloneResult> =>
  invoke("project_clone_from_github", args);
```

- [ ] **Step 3: Build the app to verify end-to-end**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -10
```

Expected: no `error` lines.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src/lib/tauri.ts
git commit -m "feat(booth-deps): register commands and add TS bindings"
```

---

## Task 7: `boothDepsStore` Zustand store

**Files:**
- Create: `src/store/boothDepsStore.ts`

- [ ] **Step 1: Create the store**

Create `src/store/boothDepsStore.ts`:

```typescript
import { create } from "zustand";
import {
  BoothDepEntry,
  tauriBoothDepsRead,
  tauriBoothDepsCheckModifications,
} from "../lib/tauri";

interface BoothDepsStore {
  /** Dependencies for the currently loaded project */
  deps: BoothDepEntry[];
  /** Deps that still need to be resolved (not yet downloaded) */
  pending: string[]; // source_ids
  resolving: boolean;
  projectPath: string | null;

  /** Load deps from disk for a given project path */
  loadDeps: (projectPath: string) => Promise<void>;
  /** Check which deps have been locally modified */
  checkModifications: () => Promise<string[]>;
  /** Mark a dep as resolved (removes from pending list) */
  resolveDep: (sourceId: string) => void;
  /** Set the pending list (called after clone + dep detection) */
  setPending: (sourceIds: string[]) => void;
  /** Clear everything (e.g. when project changes) */
  reset: () => void;
}

export const useBoothDepsStore = create<BoothDepsStore>((set, get) => ({
  deps: [],
  pending: [],
  resolving: false,
  projectPath: null,

  loadDeps: async (projectPath: string) => {
    try {
      const deps = await tauriBoothDepsRead(projectPath);
      set({ deps, projectPath });
    } catch (e) {
      console.error("Failed to load booth-deps:", e);
    }
  },

  checkModifications: async () => {
    const { projectPath } = get();
    if (!projectPath) return [];
    try {
      const modified = await tauriBoothDepsCheckModifications(projectPath);
      // Reload deps to reflect updated `modified` flags
      const deps = await tauriBoothDepsRead(projectPath);
      set({ deps });
      return modified;
    } catch (e) {
      console.error("Failed to check modifications:", e);
      return [];
    }
  },

  resolveDep: (sourceId: string) => {
    set((s) => ({ pending: s.pending.filter((id) => id !== sourceId) }));
  },

  setPending: (sourceIds: string[]) => {
    set({ pending: sourceIds });
  },

  reset: () => set({ deps: [], pending: [], resolving: false, projectPath: null }),
}));
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `boothDepsStore.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/store/boothDepsStore.ts
git commit -m "feat(booth-deps): add boothDepsStore Zustand store"
```

---

## Task 8: `BoothDepCard` component

**Files:**
- Create: `src/components/projects/BoothDepCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/projects/BoothDepCard.tsx`:

```tsx
import { useState } from "react";
import { BoothDepEntry } from "../../lib/tauri";
import { CheckCircle2, ExternalLink, FolderOpen, Loader2, Package } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface Props {
  dep: BoothDepEntry;
  owned: boolean; // whether the current user owns this item in Booth
  onResolved: (sourceId: string) => void;
}

export function BoothDepCard({ dep, owned, onResolved }: Props) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleOpenInBooth = () => {
    const url = `https://booth.pm/en/items/${dep.source_id}`;
    window.open(url, "_blank");
  };

  const handleImportLocal = async () => {
    try {
      const selected = await openDialog({
        filters: [{ name: "Unity Package", extensions: ["unitypackage", "zip"] }],
        multiple: false,
      });
      if (selected) {
        // Mark as resolved — actual import handled by existing inventory flow
        onResolved(dep.source_id);
      }
    } catch (e) {
      console.error("File picker error:", e);
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/60">
      <div className="flex-shrink-0 mt-0.5">
        {status === "done" ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        ) : status === "downloading" ? (
          <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
        ) : (
          <Package className="h-4 w-4 text-zinc-500" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100 truncate">{dep.name}</p>
        <p className="text-xs text-zinc-500 truncate">{dep.author}</p>
        {dep.modified && (
          <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25">
            ⚠ Customized — tracked in git
          </span>
        )}
        {errorMsg && (
          <p className="text-xs text-red-400 mt-1">{errorMsg}</p>
        )}
      </div>

      {status !== "done" && (
        <div className="flex flex-col gap-1 flex-shrink-0">
          {!owned ? (
            <>
              <button
                onClick={handleOpenInBooth}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-pink-500/15 text-pink-300 border border-pink-500/25 hover:bg-pink-500/25 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                Open in Booth
              </button>
              <button
                onClick={handleImportLocal}
                className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 border border-zinc-600 hover:bg-zinc-600 transition-colors"
              >
                <FolderOpen className="h-3 w-3" />
                Import local file
              </button>
            </>
          ) : (
            <span className="text-[11px] px-2 py-1 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
              ✓ Owned
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | grep "BoothDepCard" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/projects/BoothDepCard.tsx
git commit -m "feat(booth-deps): add BoothDepCard component"
```

---

## Task 9: `DependencyResolverModal` component

**Files:**
- Create: `src/components/projects/DependencyResolverModal.tsx`

- [ ] **Step 1: Create the modal**

Create `src/components/projects/DependencyResolverModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import { X, FlaskConical } from "lucide-react";
import { BoothDepEntry, tauriBoothDepsRead } from "../../lib/tauri";
import { useShopStore } from "../../store/shopStore";
import { useBoothDepsStore } from "../../store/boothDepsStore";
import { BoothDepCard } from "./BoothDepCard";

interface Props {
  projectPath: string;
  onClose: () => void;
}

export function DependencyResolverModal({ projectPath, onClose }: Props) {
  const { boothOwnedIds } = useShopStore();
  const { deps, pending, loadDeps, resolveDep } = useBoothDepsStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    loadDeps(projectPath).finally(() => setLoading(false));
  }, [projectPath]);

  const unresolvedDeps = deps.filter((d) => pending.includes(d.source_id));
  const resolvedCount = deps.length - unresolvedDeps.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-100">Booth Dependencies</h2>
              <span
                className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
                style={{
                  background: "rgba(251,191,36,0.12)",
                  border: "1px solid rgba(251,191,36,0.4)",
                  color: "#fbbf24",
                }}
              >
                <FlaskConical className="h-2 w-2" />β
              </span>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading
                ? "Loading dependencies…"
                : `${resolvedCount} of ${deps.length} resolved`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-zinc-500 text-center py-8">Loading…</p>
          ) : deps.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No dependencies found.</p>
          ) : (
            deps.map((dep) => (
              <BoothDepCard
                key={dep.source_id}
                dep={dep}
                owned={boothOwnedIds.has(dep.source_id)}
                onResolved={resolveDep}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          {unresolvedDeps.length > 0 && (
            <span className="text-xs text-zinc-500 mr-auto self-center">
              {unresolvedDeps.length} pending — you can resolve these later
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
          >
            {unresolvedDeps.length === 0 ? "Done" : "Resolve later"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/projects/DependencyResolverModal.tsx
git commit -m "feat(booth-deps): add DependencyResolverModal"
```

---

## Task 10: `CloneFromGithubModal` component

**Files:**
- Create: `src/components/projects/CloneFromGithubModal.tsx`

- [ ] **Step 1: Create the modal**

Create `src/components/projects/CloneFromGithubModal.tsx`:

```tsx
import { useState, useEffect } from "react";
import { X, Github, FlaskConical, FolderOpen, Loader2 } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { tauriProjectCloneFromGithub, CloneResult } from "../../lib/tauri";
import { useBoothDepsStore } from "../../store/boothDepsStore";

interface Props {
  onClose: () => void;
  onCloned: (result: CloneResult) => void;
}

export function CloneFromGithubModal({ onClose, onCloned }: Props) {
  const [url, setUrl] = useState("");
  const [dest, setDest] = useState("");
  const [status, setStatus] = useState<"idle" | "cloning" | "done" | "error">("idle");
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { setPending } = useBoothDepsStore();

  useEffect(() => {
    const unlisten = listen<string>("booth-deps:clone-progress", (e) => {
      setProgressLines((prev) => [...prev.slice(-20), e.payload]);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handlePickDest = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected) setDest(selected as string);
  };

  const handleClone = async () => {
    if (!url.trim() || !dest.trim()) return;
    setStatus("cloning");
    setErrorMsg(null);
    setProgressLines([]);
    try {
      const result = await tauriProjectCloneFromGithub({ url: url.trim(), dest: dest.trim() });
      setStatus("done");
      onCloned(result);
    } catch (e) {
      setStatus("error");
      setErrorMsg(String(e));
    }
  };

  const isCloning = status === "cloning";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-zinc-400" />
            <h2 className="text-base font-semibold text-zinc-100">Clone from GitHub</h2>
            <span
              className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
              style={{
                background: "rgba(251,191,36,0.12)",
                border: "1px solid rgba(251,191,36,0.4)",
                color: "#fbbf24",
              }}
            >
              <FlaskConical className="h-2 w-2" />β
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={isCloning}
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Repository URL</label>
            <input
              type="text"
              placeholder="https://github.com/user/repo"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isCloning}
              className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Destination folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="C:\Users\you\Projects"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                disabled={isCloning}
                className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
              />
              <button
                onClick={handlePickDest}
                disabled={isCloning}
                className="px-2.5 py-2 rounded-md bg-zinc-700 border border-zinc-600 text-zinc-300 hover:bg-zinc-600 transition-colors disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
              </button>
            </div>
          </div>

          {progressLines.length > 0 && (
            <div className="rounded-md bg-zinc-950 border border-zinc-800 p-2 max-h-28 overflow-y-auto">
              {progressLines.map((line, i) => (
                <p key={i} className="text-[11px] text-zinc-400 font-mono leading-snug">
                  {line}
                </p>
              ))}
            </div>
          )}

          {errorMsg && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            disabled={isCloning}
            className="px-3 py-1.5 rounded-md text-sm bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            disabled={isCloning || !url.trim() || !dest.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-violet-600 text-white hover:bg-violet-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCloning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isCloning ? "Cloning…" : "Clone"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/projects/CloneFromGithubModal.tsx
git commit -m "feat(booth-deps): add CloneFromGithubModal component"
```

---

## Task 11: `DependencyStatusPanel` component

**Files:**
- Create: `src/components/projects/DependencyStatusPanel.tsx`

- [ ] **Step 1: Create the panel**

Create `src/components/projects/DependencyStatusPanel.tsx`:

```tsx
import { AlertTriangle } from "lucide-react";
import { useBoothDepsStore } from "../../store/boothDepsStore";

interface Props {
  onOpenResolver: () => void;
}

export function DependencyStatusPanel({ onOpenResolver }: Props) {
  const { pending } = useBoothDepsStore();

  if (pending.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
      <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />
      <p className="text-sm text-amber-300 flex-1">
        <span className="font-medium">{pending.length} Booth {pending.length === 1 ? "dependency" : "dependencies"} pending.</span>
        {" "}Some assets may be missing from this project.
      </p>
      <button
        onClick={onOpenResolver}
        className="text-xs px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors flex-shrink-0"
      >
        Resolve
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/projects/DependencyStatusPanel.tsx
git commit -m "feat(booth-deps): add DependencyStatusPanel component"
```

---

## Task 12: Wire "Clone from GitHub" button into Projects page

**Files:**
- Modify: `src/pages/Projects.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/pages/Projects.tsx`, add these imports (with the existing import block):

```tsx
import { Github, FlaskConical } from "lucide-react";
import { CloneFromGithubModal } from "../components/projects/CloneFromGithubModal";
import { DependencyResolverModal } from "../components/projects/DependencyResolverModal";
import { DependencyStatusPanel } from "../components/projects/DependencyStatusPanel";
import { CloneResult, tauriListProjects } from "../lib/tauri";
import { useBoothDepsStore } from "../store/boothDepsStore";
```

- [ ] **Step 2: Add modal state**

Inside the `Projects` component (near other `useState` calls), add:

```tsx
const [showCloneModal, setShowCloneModal] = useState(false);
const [showResolverModal, setShowResolverModal] = useState(false);
const [resolverProjectPath, setResolverProjectPath] = useState<string | null>(null);
const { setPending, deps } = useBoothDepsStore();
```

- [ ] **Step 3: Add clone completion handler**

Inside the `Projects` component, add:

```tsx
const handleCloned = async (result: CloneResult) => {
  setShowCloneModal(false);
  // Refresh projects list
  try {
    const projects = await tauriListProjects();
    setProjects(projects);
  } catch (e) {
    console.error(e);
  }
  // If booth-deps.toml was found, open the resolver
  if (result.has_booth_deps) {
    setResolverProjectPath(result.path);
    // All deps start as pending until resolved
    const { tauriBoothDepsRead } = await import("../lib/tauri");
    const depList = await tauriBoothDepsRead(result.path).catch(() => []);
    setPending(depList.map((d) => d.source_id));
    setShowResolverModal(true);
  }
};
```

- [ ] **Step 4: Add "Clone from GitHub" button to the page header**

Find the existing header area in `Projects.tsx` that contains buttons like "New Project" or "Scan". Add the clone button next to them:

```tsx
<button
  onClick={() => setShowCloneModal(true)}
  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
>
  <Github className="h-3.5 w-3.5" />
  Clone from GitHub
  <span
    className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded"
    style={{
      background: "rgba(251,191,36,0.12)",
      border: "1px solid rgba(251,191,36,0.4)",
      color: "#fbbf24",
    }}
  >
    <FlaskConical className="h-2 w-2" />β
  </span>
</button>
```

- [ ] **Step 5: Render modals at the bottom of the JSX**

At the end of the `Projects` component's return statement (before the closing `</div>`), add:

```tsx
{showCloneModal && (
  <CloneFromGithubModal
    onClose={() => setShowCloneModal(false)}
    onCloned={handleCloned}
  />
)}
{showResolverModal && resolverProjectPath && (
  <DependencyResolverModal
    projectPath={resolverProjectPath}
    onClose={() => setShowResolverModal(false)}
  />
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd E:/vrcstudio && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Projects.tsx
git commit -m "feat(booth-deps): wire Clone from GitHub button and resolver flow into Projects page"
```

---

## Task 13: Auto-add to booth-deps.toml on download

**Files:**
- Modify: `src-tauri/src/commands/shop.rs`

This task hooks the `start_download` command to call `booth_deps_add` when a Booth item finishes downloading, if there's an active project set.

- [ ] **Step 1: Add the active project lookup**

In `src-tauri/src/commands/shop.rs`, find the end of the `start_download` function (just before `Ok(item_id)`). Add the following after the `app.emit("download://progress", ...)` call:

```rust
    // Auto-add to booth-deps.toml if a project is active
    // We read the active project path from app settings (stored in DB)
    if source == "booth" {
        let active_project: Option<String> = {
            let conn_result = pool.get();
            conn_result.ok().and_then(|c| {
                c.query_row(
                    "SELECT value FROM app_settings WHERE key = 'active_project_path'",
                    [],
                    |row| row.get(0),
                )
                .ok()
            })
        };

        if let Some(project_path) = active_project {
            let install_path = format!("Assets/Booth/{}", slug_from_name(&name));
            // booth_deps_add is sync — run in blocking thread
            let project_path_clone = project_path.clone();
            let source_id_clone = source_id.clone();
            let name_clone = name.clone();
            let author_clone = author.clone();
            let local_path_clone = local_path.clone();
            let install_path_clone = install_path.clone();
            tokio::task::spawn_blocking(move || {
                let _ = crate::commands::booth_deps::booth_deps_add_impl(
                    &project_path_clone,
                    &source_id_clone,
                    &name_clone,
                    &author_clone,
                    &local_path_clone,
                    &install_path_clone,
                );
            });
        }
    }
```

- [ ] **Step 2: Add the `slug_from_name` helper to `shop.rs`**

Add this helper function anywhere in `shop.rs` (not a command, just a free function):

```rust
fn slug_from_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
```

- [ ] **Step 3: Expose a public `booth_deps_add_impl` in `booth_deps.rs`**

In `src-tauri/src/commands/booth_deps.rs`, refactor `booth_deps_add` to extract the impl into a public function callable from `shop.rs`:

```rust
/// Callable from other modules (e.g. shop.rs) without going through Tauri command routing.
pub fn booth_deps_add_impl(
    project_path: &str,
    source_id: &str,
    name: &str,
    author: &str,
    zip_path: &str,
    install_path: &str,
) -> Result<(), String> {
    let version_hash = file_sha256(Path::new(zip_path))?;

    let mut file_hashes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let extracted_dir = Path::new(project_path).join(install_path);
    if extracted_dir.exists() {
        for entry in walkdir::WalkDir::new(&extracted_dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let rel = entry
                .path()
                .strip_prefix(&extracted_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let hash = file_sha256(entry.path()).unwrap_or_default();
            file_hashes.insert(rel, hash);
        }
    }

    let hashes_dir = Path::new(project_path).join(".vrcstudio").join("hashes");
    fs::create_dir_all(&hashes_dir).map_err(|e| e.to_string())?;
    let snapshot_path = hashes_dir.join(format!("{}.json", source_id));
    let snapshot_json = serde_json::to_string_pretty(&file_hashes).map_err(|e| e.to_string())?;
    fs::write(&snapshot_path, snapshot_json).map_err(|e| e.to_string())?;

    let mut manifest = read_manifest(project_path)?;
    manifest.dependency.retain(|d| d.source_id != source_id);
    manifest.dependency.push(BoothDepEntry {
        source: "booth".to_string(),
        source_id: source_id.to_string(),
        name: name.to_string(),
        author: author.to_string(),
        version_hash,
        install_path: install_path.to_string(),
        added_at: chrono::Utc::now().format("%Y-%m-%d").to_string(),
        modified: false,
    });
    write_manifest(project_path, &manifest)?;
    booth_deps_update_gitignore_impl(project_path, install_path, true)
}

/// Tauri command — delegates to `booth_deps_add_impl`.
#[tauri::command]
pub fn booth_deps_add(
    project_path: String,
    source_id: String,
    name: String,
    author: String,
    zip_path: String,
    install_path: String,
) -> Result<(), String> {
    booth_deps_add_impl(&project_path, &source_id, &name, &author, &zip_path, &install_path)
}
```

> Note: Remove the earlier `booth_deps_add` implementation from Task 3 — this refactored version replaces it.

- [ ] **Step 4: Check active_project_path storage**

Verify that the key `active_project_path` is actually stored in `app_settings`. Run:

```bash
grep -rn "active_project_path\|active_project" E:/vrcstudio/src-tauri/src/ | head -10
grep -rn "active_project" E:/vrcstudio/src/ | head -10
```

If the key doesn't exist in the DB schema, check how the active project is tracked (it may be in a different table or key). Adjust the SQL query accordingly.

- [ ] **Step 5: Verify compilation**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

Expected: no `error` lines.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/shop.rs src-tauri/src/commands/booth_deps.rs
git commit -m "feat(booth-deps): auto-add dependency to booth-deps.toml on Booth download"
```

---

## Task 14: Manual test and final check

- [ ] **Step 1: Build the full app**

```bash
cd E:/vrcstudio && npm run tauri dev
```

Expected: app starts without compilation errors.

- [ ] **Step 2: Test Clone from GitHub**

1. Click "Clone from GitHub" button in Projects — BETA badge should be visible
2. Enter a public GitHub repo URL + pick a destination folder
3. Click "Clone" — progress output should stream in the terminal area
4. After clone completes, project should appear in the Projects list

- [ ] **Step 3: Test booth-deps.toml detection**

1. Create a dummy `booth-deps.toml` in a local folder (format as per spec)
2. Clone a repo that contains it
3. Verify `DependencyResolverModal` opens automatically after clone

- [ ] **Step 4: Test download auto-registration**

1. Set an active project in VRC Studio
2. Download a Booth item from the Shop
3. Check that `booth-deps.toml` appears in the project folder with the entry
4. Check that `.gitignore` has the entry for `Assets/Booth/{slug}/`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(booth-deps): complete Booth dependency system + Clone from GitHub (BETA)"
```

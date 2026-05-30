# Booth Dependencies System + Clone from GitHub

**Date:** 2026-05-30  
**Status:** Approved  
**Scope:** VRC Studio — git integration, Booth package manifest, dependency resolution

---

## Overview

VRC Studio adds two tightly coupled features:

1. **Booth Dependencies Manifest** — a `booth-deps.toml` file in the Unity project root that tracks which Booth packages the project needs, so assets are never pushed to GitHub (only the manifest is).
2. **Clone from GitHub** — a new BETA button in the Projects section that clones a repo and, if a `booth-deps.toml` is found, automatically resolves all Booth dependencies.

Both features are marked **BETA** in the UI.

---

## Manifest Format — `booth-deps.toml`

Lives at the root of the Unity project directory.

```toml
[metadata]
vrcstudio_version = "1.0"
created_at = "2026-05-30"

[[dependency]]
source = "booth"
source_id = "12345678"
name = "Outfit - Selestia Dress"
author = "AuthorName"
version_hash = "abc123def456..."   # SHA256 of the original downloaded .zip
install_path = "Assets/Booth/selestia-dress"
added_at = "2026-05-30"
modified = false                   # true when VRC Studio detects local changes
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Always `"booth"` for now |
| `source_id` | string | Booth item ID |
| `name` | string | Display name at time of download |
| `author` | string | Author at time of download |
| `version_hash` | string | SHA256 of the original `.zip` file |
| `install_path` | string | Relative path inside Unity project |
| `added_at` | string | ISO date when added |
| `modified` | bool | `true` if local files differ from original hash snapshot |

---

## Architecture — Hybrid Rust/TypeScript

Rust (Tauri commands) handles all filesystem, hashing, and git operations. TypeScript (Zustand store + React components) handles UI state and flow logic. This matches VRC Studio's existing patterns.

### New Tauri Commands

| Command | Responsibility |
|---------|---------------|
| `booth_deps_add` | Add a dependency entry to `booth-deps.toml` after download |
| `booth_deps_read` | Parse `booth-deps.toml` from a project path |
| `booth_deps_check_modifications` | Compare current file hashes vs `.vrcstudio/hashes/{id}.json` snapshot |
| `booth_deps_update_gitignore` | Add/remove install_path entries in `.gitignore` |
| `project_clone_from_github` | Run `git clone <url> <dest>`, return cloned path |

### New Zustand Store — `boothDepsStore`

```typescript
interface BoothDepsStore {
  deps: BoothDep[];           // current project's deps
  pending: BoothDep[];        // deps not yet resolved (unowned or failed)
  resolving: boolean;
  loadDeps: (projectPath: string) => Promise<void>;
  checkModifications: (projectPath: string) => Promise<void>;
}
```

---

## Flow 1: Automatic Manifest Update on Download

When a user downloads a Booth package from the Shop while a project is active:

1. Download completes → Rust saves the `.zip` temporarily
2. `booth_deps_add` is called with the package metadata
3. Rust computes SHA256 of the `.zip` → stores in `booth-deps.toml` as `version_hash`
4. Rust extracts files to `install_path` → computes per-file hashes → saves snapshot to `.vrcstudio/hashes/{source_id}.json`
5. Rust appends `install_path` to the project's `.gitignore`
6. `booth-deps.toml` itself is **not** gitignored (it should be committed)

---

## Flow 2: Modification Detection

Triggered manually via "Check modifications" button in project view, or automatically before any git operation.

1. For each dep in `booth-deps.toml` where `modified = false`:
   - Load snapshot from `.vrcstudio/hashes/{source_id}.json`
   - Walk `install_path`, compute SHA256 of each file
   - If any file hash differs → mark `modified = true` in `.toml`
   - Call `booth_deps_update_gitignore` to **remove** `install_path` from `.gitignore` (so git tracks those changes)
2. UI shows which packages have been customized with a visual indicator

---

## Flow 3: Clone from GitHub

### Entry point
New button in the Projects section header: **"Clone from GitHub"** with a BETA badge.

### Steps

```
1. User clicks "Clone from GitHub"
2. CloneFromGithubModal opens:
   - Input: GitHub repo URL
   - Input: destination folder (picker)
   - [Clone] button
3. Rust: git clone <url> <dest>
   - Progress streamed to UI (stdout lines)
4. Check for booth-deps.toml at <dest>/booth-deps.toml
   ├── Not found → add project normally, done
   └── Found → open DependencyResolverModal
5. DependencyResolverModal:
   - For each dep:
     ├── Owned in Booth (boothOwnedIds) → auto-download, shows progress
     └── Not owned → card with two actions:
           • "Open in Booth" → opens booth.pm/en/items/{id} in browser
           • "Import local file" → file picker for .unitypackage
   - [Resolve later] button → closes modal, shows DependencyStatusPanel
6. Project is added to VRC Studio regardless (non-blocking)
```

### DependencyStatusPanel

Persistent panel shown in the project detail view when `pending.length > 0`. Shows count of unresolved deps with a link to open `DependencyResolverModal` again.

---

## New UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| `CloneFromGithubModal` | `src/components/projects/` | URL input + clone progress |
| `DependencyResolverModal` | `src/components/projects/` | Per-dep resolution cards |
| `DependencyStatusPanel` | `src/components/projects/` | Persistent pending deps banner |
| `BoothDepCard` | `src/components/projects/` | Single dep card within resolver |

All entry points use the existing `BetaTag` component (amber, FlaskConical icon).

---

## .gitignore Strategy

When a dep is added:
```
# Added by VRC Studio - Booth Dependency
Assets/Booth/selestia-dress/
```

When a dep is detected as modified (`modified = true`):
- The above line is removed from `.gitignore`
- `booth-deps.toml` entry updated to `modified = true`
- User sees visual indicator: "⚠ Customized — tracked in git"

`booth-deps.toml` and `.vrcstudio/hashes/` are never gitignored.  
`.vrcstudio/` itself should be committed (it stores the hash snapshots needed by other collaborators to detect their own modifications).

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `git clone` fails | Show error in modal, allow retry |
| Booth download fails during resolution | Show error on dep card, allow retry |
| `booth-deps.toml` malformed | Show parse error, skip dependency resolution |
| Active project not set when downloading | Show toast: "Set an active project to track dependencies" |
| Hash snapshot missing | Treat dep as unmodified (conservative) |

---

## Out of Scope (v1)

- Non-Booth sources (riperstore) in the manifest
- Automatic pre-commit hook installation in the Unity project git repo
- Diff viewer for modified files
- Sharing/publishing booth-deps.toml to a registry
- Multi-project dep tracking (one manifest per project only)

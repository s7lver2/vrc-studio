# VRC Studio — Project Creation Rework + Early Import

**Date:** 2026-06-04  
**Status:** Approved  
**Scope:** Two independent features delivered together — (A) visual/UX refresh of the project creation wizard and (B) the new Early Import system including project properties integration.

---

## 1. Carousel Splash Screen — Direction C

### What changes
The `SplashScreenCarousel` bottom panel is redesigned to follow the "C" (minimal editorial) direction approved in brainstorming:

- **Left side:** large typographic title (image title for built-ins, date for VRChat photos) + secondary line (artist credit or time) + horizontal progress bar + slideshow dot indicators
- **Right side:** "VRC Studio" wordmark + logo mark (white)
- No floating chip, no right-panel sidebar — everything in one horizontal bottom strip with a gradient

### Metadata sources

| Photo type | Title line | Subtitle line |
|---|---|---|
| Built-in (`builtInId`) | `meta.title` | `Photo by ${meta.artist}` |
| VRChat (path) | `Jan 15, 2024` (parsed from filename) | `HH:mm:ss · VRChat` |
| Custom (user upload) | filename without extension | *(omitted)* |

### VRChat filename parsing
VRChat names files as: `VRChat_YYYY-MM-DD_HH-MM-SS.mmm_WxH.png`  
Regex: `/VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/`  
Falls back gracefully — if pattern doesn't match, no date is shown.

### Slideshow dots
Shown only when `imageList.length > 1`. Active dot is wider (pill shape). Max 8 dots shown; if more images exist, show `…` or cap display at 8.

---

## 2. Project Creation Wizard — 3-Step Rework

### Current state
Two steps: Setup → Packages. Step indicator is minimal.

### New structure
Three steps: **Setup → Packages → Early Import**

The step indicator shows: numbered circle (active = red, done = green checkmark, pending = gray) + label.

### Step 1 — Setup (redesigned)
Fields (same data, improved layout):
- **Name** — text input, placeholder "Mi Avatar Project"
- **Destination folder** — text + browse button (folder icon)
- **Unity version** — pill selector (only detected/allowed versions shown)
- Divider
- **VCS toggle** — inline row with label + description + toggle

No changes to the data submitted. Visual/layout refresh only.

### Step 2 — Packages (redesigned header only)
Same package picker logic. New step indicator replaces old one. Search bar + Recommended section + Others section kept as-is.

### Step 3 — Early Import (new)

**Purpose:** Let users select inventory items to be automatically extracted into the Unity project on first open.

**UI:**
- Info banner explaining the behavior (one sentence)
- Search bar filtering inventory items by name/author
- Grid of inventory item thumbnails (same card style as inventory grid — cover image or fallback emoji)
- Selected items show a red checkmark badge
- Badge at the bottom: "⚡ N items seleccionados"
- Buttons: `← Atrás` · `Omitir` (skips without selecting) · `Crear proyecto`

**Data stored:** list of `inventory_item_id` values per project (new DB table `project_early_imports`).

**Constraint:** List is fixed after project creation. No editing from properties panel.

---

## 3. Early Import System

### Database — new table
```sql
CREATE TABLE project_early_imports (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'done' | 'error'
  imported_at TEXT,
  error_msg   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);
```

### First-open detection
The `projects` table gains a new boolean column: `early_import_done BOOLEAN NOT NULL DEFAULT 1`.  
When a project is created with early imports, this is set to `0`.  
When `open_project_in_unity` is called:
1. Read `early_import_done` for the project
2. If `0`: run early import sequence, then set to `1`, then open Unity
3. If `1`: open Unity immediately (existing behavior)

### Import sequence (Rust, `open_project_in_unity`)
For each pending `project_early_imports` row (ordered by `sort_order`):
1. Emit Tauri event `early_import_progress` → `{ item_id, item_name, current, total, status: "extracting" }`
2. Extract the item's ZIP to `{project_path}/Assets/EarlyImports/{sanitized_item_name}/`
   - `sanitized_item_name` = item name with characters outside `[A-Za-z0-9 _-]` replaced by `_`
   - Uses the existing extraction logic (same as inventory decompress flow)
   - Target path must be inside the project (never outside — validate with `starts_with`)
3. Update row status to `done` (or `error` with message)
4. Emit `early_import_progress` → `{ ..., status: "done" }`
5. After all items: emit `early_import_progress` → `{ status: "complete", total }`
6. Set `early_import_done = 1` on the project
7. Launch Unity

If extraction fails for one item: mark it `error`, continue with next item (non-blocking).

### Frontend — toast notification
`useProjectEvents` hook (or a new `useEarlyImportProgress` hook) listens for `early_import_progress` events.  
A toast component (bottom-right of the app) shows:
- During: icon ⚡ + "Early Import" title + "Extrayendo [name]… (X de Y)" + progress bar
- On complete: icon ✅ + "Early Import completado" + "N items extraídos correctamente"
- Toast auto-dismisses after 4 seconds on completion

---

## 4. Project Properties — "Imports" Tab

### Location
New tab `Imports` added to `ProjectDetailModal`, after `Packages`.

### Content
- Filter row: text search + type dropdown (All / Avatar / Clothing / etc.)
- Status tabs: `✓ Importados (N)` · `⏳ Pendientes (N)` · `Todos (N)`
- Item grid: same card size as inventory grid (64×64px thumb + name below)
  - Green dot badge = `done`
  - Yellow dot badge = `pending` (Unity not opened yet)
  - Red dot badge = `error` (with hover tooltip showing error message)
- Read-only — no add/remove

### Data
New Tauri command `get_project_early_imports(project_id) → Vec<EarlyImportEntry>` where `EarlyImportEntry` includes: `item_id`, `item_name`, `thumbnail_url`, `status`, `imported_at`, `error_msg`.

---

## 5. New Tauri Commands

| Command | Description |
|---|---|
| `get_project_early_imports(project_id)` | Returns the early import list with status for a project |

The existing `create_project` command gains a new field in `CreateProjectRequest`:
```rust
pub early_import_item_ids: Vec<String>,  // empty = no early imports
```

The existing `open_project_in_unity` command gains the early import orchestration logic.

---

## 6. Data Flow Summary

```
Wizard Step 3 → user selects items
  ↓
create_project(request { ..., early_import_item_ids })
  → INSERT INTO project_early_imports (status='pending')
  → SET projects.early_import_done = 0

User clicks "Open in Unity"
  ↓
open_project_in_unity
  → early_import_done == 0?
    → for each pending item:
        emit early_import_progress(extracting)
        extract ZIP → Assets/EarlyImports/[name]/
        UPDATE status → done/error
        emit early_import_progress(done)
    → emit early_import_progress(complete)
    → UPDATE early_import_done = 1
  → spawn Unity process

Frontend listens to early_import_progress events
  → shows toast
  → on complete: refreshes Imports tab data
```

---

## 7. Files Affected

### Frontend
- `src/components/SplashScreenCarousel.tsx` — carousel redesign (direction C)
- `src/components/projects/wizard/CreateProjectForm.tsx` — 3-step wizard + early import step
- `src/components/projects/ProjectDetailModal.tsx` — new Imports tab
- `src/hooks/useProjectEvents.ts` — add early_import_progress listener
- `src/lib/tauri.ts` — new command wrappers
- New: `src/components/projects/EarlyImportToast.tsx`

### Backend (Rust)
- `src-tauri/src/models/mod.rs` — add `EarlyImportEntry`, extend `CreateProjectRequest`
- `src-tauri/src/commands/projects.rs` — extend `create_project`, extend `open_project_in_unity`
- New: `src-tauri/src/db/migrations/024_early_imports.sql`
  - Creates `project_early_imports` table
  - `ALTER TABLE projects ADD COLUMN early_import_done BOOLEAN NOT NULL DEFAULT 1` (existing projects default to done)

---

## 8. Out of Scope
- Editing the early import list after project creation
- Progress shown inside Unity (Unity-side scripting)
- Cancelling an in-progress early import
- Early import for projects created before this feature

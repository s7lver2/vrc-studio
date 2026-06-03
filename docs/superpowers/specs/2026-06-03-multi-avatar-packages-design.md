# Multi-Avatar Packages — Design Spec

## Overview

Adds a **Multi-Avatar** import mode (BETA) that lets users group multiple avatar variant sub-zips (Karin, Sio, Materials, etc.) under a single inventory item. Each variant is independently openable in Unity, deletable, and compressible. A one-time **Migration Wizard** (BETA) helps users consolidate existing single-avatar items into the new format.

---

## Data Model

### DB changes

**New column** on `inventory_items`:
```sql
ALTER TABLE inventory_items ADD COLUMN is_multi_avatar INTEGER NOT NULL DEFAULT 0;
```

**New table** `inventory_item_variants`:
```sql
CREATE TABLE IF NOT EXISTS inventory_item_variants (
    id           TEXT    PRIMARY KEY,
    item_id      TEXT    NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL,          -- "Karin", "Sio", "Materials", …
    is_materials INTEGER NOT NULL DEFAULT 0,
    sub_zip_name TEXT    NOT NULL,          -- filename inside the main zip container
    sort_order   INTEGER NOT NULL DEFAULT 0
);
```

### Rust model (`models/mod.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemVariant {
    pub id: String,
    pub item_id: String,
    pub label: String,
    pub is_materials: bool,
    pub sub_zip_name: String,
    pub sort_order: i64,
    // Derived at query time (not stored):
    pub size_bytes: Option<u64>,
    pub is_compressed: bool,
}
```

### TypeScript type (`lib/tauri.ts`)

```ts
export interface ItemVariant {
  id: string;
  item_id: string;
  label: string;
  is_materials: boolean;
  sub_zip_name: string;
  sort_order: number;
  size_bytes: number | null;
  is_compressed: boolean;
}
```

`InventoryItem` gains a new optional field: `is_multi_avatar: boolean`.

---

## Tauri Commands

| Command | Args | Returns | Description |
|---|---|---|---|
| `list_zip_contents` | `zip_path: String` | `Result<Vec<String>, String>` | Lists top-level `.zip` / `.unitypackage` entries inside a zip |
| `import_multi_avatar_package` | `ImportMultiAvatarArgs` | `Result<String, String>` | Creates `inventory_item` + variants atomically; returns new item id |
| `get_item_variants` | `item_id: String` | `Result<Vec<ItemVariant>, String>` | Fetches all variants for an item, with derived size/compressed fields |
| `extract_sub_zip_to_temp` | `zip_path: String, sub_zip_name: String` | `Result<String, String>` | Extracts named entry to OS temp dir, returns path |
| `delete_variant` | `item_id: String, variant_id: String` | `Result<(), String>` | Removes DB row + rewrites container zip without that entry |
| `compress_variant` | `item_id: String, variant_id: String` | `Result<(), String>` | Extracts sub-zip, compresses with zstd, reinscribes in container |
| `decompress_variant` | `item_id: String, variant_id: String` | `Result<(), String>` | Reverse of compress_variant |
| `create_migration_backup` | — | `Result<String, String>` | Copies DB + all inventory zips to `{app_data}/backups/{timestamp}/`; returns backup path |
| `create_container_zip` | `source_paths: Vec<String>, output_path: String` | `Result<(), String>` | Creates a new zip containing the given files as top-level entries |

### `ImportMultiAvatarArgs`

```rust
pub struct ImportMultiAvatarArgs {
    pub zip_path: String,          // the container zip the user picked
    pub name: String,
    pub author: Option<String>,
    pub thumbnail_url: Option<String>,
    pub booth_id: Option<String>,
    pub product_images: Vec<String>,
    pub variants: Vec<VariantArg>,
}

pub struct VariantArg {
    pub label: String,
    pub is_materials: bool,
    pub sub_zip_name: String,      // filename inside the zip
}
```

---

## Feature 1: Import Flow

### Mode picker

At the top of `ImportLocalDialog`, above the file picker:

```
┌──────────────────────┬───────────────────────────────┐
│  ● Single Avatar     │   Multi Avatar   [BETA]        │
└──────────────────────┴───────────────────────────────┘
```

Single Avatar mode = current behavior, unchanged.

### Multi Avatar mode — extra step: Variant Mapping

After the user selects the main `.zip`:

1. System calls `list_zip_contents(zip_path)` → returns list of `.zip`/`.unitypackage` filenames inside.
2. A **Variant Mapping** section appears between the file picker and the Booth field:

```
Variants                                              [+ Add variant]  [+ Materials]
──────────────────────────────────────────────────────────────────────────────────
[Label: Karin      ]  [sub-zip: Outfit_Karin.zip ▼]  [×]
[Label: Sio        ]  [sub-zip: Outfit_Sio.zip   ▼]  [×]
[Label: Materials  ]  [sub-zip: Outfit_Mat.zip   ▼]  [×]  ← is_materials=true, lime badge
```

- **Label input**: free text. Auto-filled using the existing `detectAvatarVariants` logic run against each detected sub-zip filename.
- **Sub-zip dropdown**: lists all files returned by `list_zip_contents`. If only one file matches the auto-detected avatar, it is pre-selected.
- **`+ Add variant`**: appends an empty row.
- **`+ Materials`**: appends a row with label `"Materials"` and `is_materials=true` pre-set.
- **`×`**: removes the row.

At least one variant is required to enable the Import button in multi-avatar mode.

The rest of the form (name, author, thumbnail, Booth, tags) is identical to single-avatar mode.

### Auto-detection

When `list_zip_contents` returns results, run `detectAvatarVariants` on each filename. If results are found, pre-populate the variant list. The user can edit, reorder, or delete any pre-populated row.

---

## Feature 2: Versions Tab in Item Detail

When `item.is_multi_avatar` is true, `InventoryItemDetail` shows an additional **"Versions"** tab with a small `BETA` badge.

### Tab content

Calls `get_item_variants(item.id)` on mount.

Each variant row (collapsed):
```
[icon]  Karin        Outfit_Karin.zip  ·  24.3 MB           [Open]  [⋯]
```

- **Icon**: `Users` for avatar variants, `Layers` for materials.
- **`[Open]`**: calls `extract_sub_zip_to_temp` then opens `OpenInUnityModal` with the extracted path.
- **`[⋯]` menu**: `Delete`, `Compress` / `Decompress`.

**Expanded row** (click anywhere on the row):
- Shows `FileTreeViewer` of the sub-zip.
- FileTreeViewer receives the temp-extracted path (extracted lazily on first expand).

### Variant actions

**Open**
1. `extract_sub_zip_to_temp(item.zip_path, variant.sub_zip_name)` → temp path
2. Open `OpenInUnityModal` with temp path

**Delete**
1. Confirmation mini-dialog: "Remove [Karin] from this package? The sub-zip will be permanently deleted from the container."
2. `delete_variant(item.id, variant.id)` — removes DB row, rewrites container zip
3. Optimistic update: remove from local variant list

**Compress / Decompress**
1. `compress_variant` / `decompress_variant`
2. Variant row shows `ZIP` badge when compressed
3. Open still works on compressed variants (decompress to temp on-the-fly)

---

## Feature 3: Migration Wizard

### Entry popup

Shown once on app start if:
- `localStorage.getItem('multi_avatar_migration_dismissed') !== 'true'`
- Inventory has at least one item

```
┌──────────────────────────────────────────────────────┐
│  ✦  New: Multi-Avatar Packages                       │
│                                                      │
│  You can now group avatar variants (Karin, Sio,      │
│  Materials…) under a single inventory item.          │
│  The Migration Wizard can help you reorganise your   │
│  existing library. A backup is created automatically │
│  before any changes are made.                  [BETA]│
│                                                      │
│  [Don't show again]              [Start Migration →] │
└──────────────────────────────────────────────────────┘
```

- "Don't show again" → `localStorage.setItem('multi_avatar_migration_dismissed', 'true')`, close.
- "Start Migration →" → opens Migration Wizard modal.

### Migration Wizard (4 steps)

Large modal, full-screen overlay, `BETA` badge in header.

---

**Step 1 — Backup** (auto, non-skippable)

Shows progress bar while `create_migration_backup()` runs.  
On success: "Backup saved to `{path}`. You can restore it manually if needed."  
On failure: error message + "Retry" button. Wizard does not proceed until backup succeeds.

---

**Step 2 — Select group**

Multi-select list of all inventory items not yet migrated in this session.  
Each row: thumbnail · name · author · size.  
Checkbox to select.  
Guidance text: "Select all items that belong to the same outfit or asset."  
Button: `Group selected items →` (disabled if fewer than 2 selected).

---

**Step 3 — Configure group**

- **Name**: text input, pre-filled with longest common prefix of selected item names.
- **Author**: text input, pre-filled if all selected items share the same author.
- **Thumbnail**: same picker as import form, pre-filled from first selected item.
- **Variant mapping table**: one row per selected item.
  - Label: auto-filled via `detectAvatarVariants` on item name; editable.
  - `is_materials` toggle per row.
- Button: `Save group`

On `Save group`:
1. `create_container_zip(selected_items.map(i => i.zip_path), output_path)` — wraps originals into new zip at `{inventory_dir}/{new_id}.zip`.
2. `import_multi_avatar_package(...)` — creates new item + variants.
3. Delete original items from inventory (DB + disk) via existing `tauriDeleteInventoryItem` with `InventoryAndDisk`.
4. Show inline success: "Group saved. N items merged."

---

**Step 4 — More groups?**

After saving a group:
```
┌──────────────────────────────────────────────┐
│  ✓  "MyOutfit" migrated (3 variants)         │
│                                              │
│  [← Add another group]        [Finish →]    │
└──────────────────────────────────────────────┘
```

"Add another group" → back to Step 2 (already-migrated items excluded).  
"Finish" → close wizard, show toast: "Migration complete. N groups created."

---

## New Files

| File | Purpose |
|---|---|
| `src-tauri/src/commands/multi_avatar.rs` | All new Tauri commands |
| `src-tauri/src/db/migrations/002_multi_avatar.sql` | DB migration (ALTER + CREATE) |
| `src/components/inventory/VersionsTab.tsx` | Versions tab component |
| `src/components/inventory/MigrationPopup.tsx` | Entry popup |
| `src/components/inventory/MigrationWizard.tsx` | Full 4-step wizard |

## Modified Files

| File | Change |
|---|---|
| `src-tauri/src/commands/mod.rs` | `pub mod multi_avatar;` |
| `src-tauri/src/lib.rs` | Register new commands + DB migration |
| `src-tauri/src/models/mod.rs` | Add `ItemVariant`, `ImportMultiAvatarArgs`, `VariantArg`; add `is_multi_avatar` to `InventoryItem` |
| `src/lib/tauri.ts` | Add `ItemVariant` type + all new command wrappers |
| `src/components/inventory/ImportLocalDialog.tsx` | Mode picker + Variant Mapping section |
| `src/components/inventory/InventoryItemDetail.tsx` | Add "Versions" tab when `is_multi_avatar` |
| `src/App.tsx` | Render `<MigrationPopup>` on mount |

---

## Out of Scope

- Multi-select drag (separate spec)
- Editing variant labels after import (future)
- Nested multi-avatar groups
- Syncing variants with Booth product updates

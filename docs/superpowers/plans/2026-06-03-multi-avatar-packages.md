# Multi-Avatar Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Multi-Avatar import mode that groups avatar variant sub-zips under one inventory item, with a Versions tab to open/delete/compress each variant, plus a Migration Wizard to consolidate existing items.

**Architecture:** New Rust command module `multi_avatar.rs` handles all zip manipulation and DB work. DB migration 021 adds `is_multi_avatar` column and `inventory_item_variants` table. Frontend adds a mode picker to `ImportLocalDialog`, a new `VersionsTab` component, and a `MigrationWizard` that is surfaced by a one-time `MigrationPopup` in `App.tsx`.

**Tech Stack:** Rust + `zip` crate (already in Cargo.toml), SQLite via `rusqlite`, React/TypeScript, Tauri 2, `@dnd-kit`, Lucide icons.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src-tauri/src/db/migrations/021_multi_avatar.sql` | Create | ALTER + CREATE TABLE |
| `src-tauri/src/db/mod.rs` | Modify | Register migration 21 |
| `src-tauri/src/models/mod.rs` | Modify | Add `ItemVariant`, `ImportMultiAvatarArgs`, `VariantArg`; add `is_multi_avatar` to `InventoryItem` |
| `src-tauri/src/commands/multi_avatar.rs` | Create | All 8 new Tauri commands |
| `src-tauri/src/commands/mod.rs` | Modify | `pub mod multi_avatar;` |
| `src-tauri/src/lib.rs` | Modify | Register commands |
| `src/lib/tauri.ts` | Modify | TS types + command wrappers |
| `src/components/inventory/ImportLocalDialog.tsx` | Modify | Mode picker + Variant Mapping section |
| `src/components/inventory/VersionsTab.tsx` | Create | Versions tab with Open/Delete/Compress |
| `src/components/inventory/InventoryItemDetail.tsx` | Modify | Add "versions" tab |
| `src/components/inventory/MigrationPopup.tsx` | Create | One-time entry popup |
| `src/components/inventory/MigrationWizard.tsx` | Create | 4-step migration wizard |
| `src/App.tsx` | Modify | Render `<MigrationPopup>` on mount |

---

## Task 1: DB migration + Rust model additions

**Files:**
- Create: `src-tauri/src/db/migrations/021_multi_avatar.sql`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/models/mod.rs`

- [ ] **Step 1: Create migration file**

```sql
-- src-tauri/src/db/migrations/021_multi_avatar.sql
ALTER TABLE inventory_items ADD COLUMN is_multi_avatar INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_item_variants (
    id           TEXT    PRIMARY KEY,
    item_id      TEXT    NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL,
    is_materials INTEGER NOT NULL DEFAULT 0,
    sub_zip_name TEXT    NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Register migration in `src-tauri/src/db/mod.rs`**

Find the line `(20, include_str!("migrations/020_tracker_v2.sql"))` and add after it:

```rust
    (21, include_str!("migrations/021_multi_avatar.sql")),
```

- [ ] **Step 3: Add models to `src-tauri/src/models/mod.rs`**

After the `InventoryItem` struct (after `folder_id` field, before the closing `}`), add `is_multi_avatar`:

```rust
    pub is_multi_avatar: bool,
```

Then after the `InventoryFolder` struct, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemVariant {
    pub id: String,
    pub item_id: String,
    pub label: String,
    pub is_materials: bool,
    pub sub_zip_name: String,
    pub sort_order: i64,
    pub size_bytes: Option<u64>,
    pub is_compressed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantArg {
    pub label: String,
    pub is_materials: bool,
    pub sub_zip_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportMultiAvatarArgs {
    pub zip_path: String,
    pub name: String,
    pub author: Option<String>,
    pub thumbnail_url: Option<String>,
    pub booth_id: Option<String>,
    pub product_images: Vec<String>,
    pub variants: Vec<VariantArg>,
    pub folder_id: Option<String>,
}
```

- [ ] **Step 4: Fix all existing places that construct `InventoryItem` to add `is_multi_avatar: false`**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "missing field"
```
For each error location, add `is_multi_avatar: row.get::<_, bool>("is_multi_avatar").unwrap_or(false),` (or equivalent) to the struct literal.

Typically this is in `src-tauri/src/commands/inventory.rs` wherever `InventoryItem { ... }` is constructed. Search with:
```bash
grep -n "InventoryItem {" src-tauri/src/commands/inventory.rs
```
For each location add the field.

- [ ] **Step 5: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output (no errors).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/migrations/021_multi_avatar.sql src-tauri/src/db/mod.rs src-tauri/src/models/mod.rs src-tauri/src/commands/inventory.rs
git commit -m "feat(multi-avatar): DB migration 021 + model additions"
```

---

## Task 2: Rust — read-only zip commands

**Files:**
- Create: `src-tauri/src/commands/multi_avatar.rs`

- [ ] **Step 1: Create the file with `list_zip_contents` and `get_item_variants`**

```rust
// src-tauri/src/commands/multi_avatar.rs
use crate::db::DbPool;
use crate::error::AppError;
use crate::models::{ImportMultiAvatarArgs, ItemVariant};
use rusqlite::params;
use std::io::Read;
use std::path::Path;
use tauri::State;
use uuid::Uuid;
use zip::ZipArchive;

/// Lists top-level .zip / .unitypackage entries inside a container zip.
#[tauri::command]
pub async fn list_zip_contents(zip_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Cannot open zip: {e}"))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;

        let mut names: Vec<String> = Vec::new();
        for i in 0..archive.len() {
            let entry = archive.by_index(i)
                .map_err(|e| format!("Zip read error: {e}"))?;
            let name = entry.name().to_string();
            // Only top-level entries (no path separator) that are zip/unitypackage
            if !name.contains('/') && !name.contains('\\') {
                let lower = name.to_lowercase();
                if lower.ends_with(".zip") || lower.ends_with(".unitypackage") {
                    names.push(name);
                }
            }
        }
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Extracts a named entry from the container zip to the OS temp directory.
/// Returns the path to the extracted file.
#[tauri::command]
pub async fn extract_sub_zip_to_temp(
    zip_path: String,
    sub_zip_name: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Cannot open zip: {e}"))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;

        let mut entry = archive
            .by_name(&sub_zip_name)
            .map_err(|_| format!("Entry '{}' not found in zip", sub_zip_name))?;

        let temp_dir = std::env::temp_dir().join("vrc_studio_variants");
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Cannot create temp dir: {e}"))?;

        let out_path = temp_dir.join(&sub_zip_name);
        let mut out_file = std::fs::File::create(&out_path)
            .map_err(|e| format!("Cannot write temp file: {e}"))?;
        std::io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("Extraction failed: {e}"))?;

        Ok(out_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns all variants for a given inventory item.
#[tauri::command]
pub async fn get_item_variants(
    pool: State<'_, DbPool>,
    item_id: String,
) -> Result<Vec<ItemVariant>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, item_id, label, is_materials, sub_zip_name, sort_order
         FROM inventory_item_variants
         WHERE item_id = ?1
         ORDER BY sort_order ASC, label ASC",
    )?;

    // We also need the parent item's zip_path to calculate size
    let zip_path: Option<String> = conn
        .query_row(
            "SELECT local_path FROM inventory_items WHERE id = ?1",
            params![item_id],
            |row| row.get(0),
        )
        .ok();

    let variants: Vec<ItemVariant> = stmt
        .query_map(params![item_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .map(|(id, item_id, label, is_materials, sub_zip_name, sort_order)| {
            // Derive size from zip entry
            let (size_bytes, is_compressed) =
                zip_path.as_deref().and_then(|zp| {
                    let f = std::fs::File::open(zp).ok()?;
                    let mut arch = ZipArchive::new(f).ok()?;
                    let entry = arch.by_name(&sub_zip_name).ok()?;
                    Some((Some(entry.size()), entry.compression() != zip::CompressionMethod::Stored))
                })
                .unwrap_or((None, false));

            ItemVariant {
                id,
                item_id,
                label,
                is_materials,
                sub_zip_name,
                sort_order,
                size_bytes,
                is_compressed,
            }
        })
        .collect();

    Ok(variants)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/multi_avatar.rs
git commit -m "feat(multi-avatar): list_zip_contents, extract_sub_zip_to_temp, get_item_variants"
```

---

## Task 3: Rust — import_multi_avatar_package

**Files:**
- Modify: `src-tauri/src/commands/multi_avatar.rs`

- [ ] **Step 1: Add `import_multi_avatar_package` to `multi_avatar.rs`**

Append to the file (after the existing functions):

```rust
/// Imports a container zip as a multi-avatar item.
/// Creates inventory_item with is_multi_avatar=1 and all variant rows atomically.
#[tauri::command]
pub async fn import_multi_avatar_package(
    pool: State<'_, DbPool>,
    args: ImportMultiAvatarArgs,
) -> Result<String, AppError> {
    let conn = pool.get()?;
    let item_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Compute file size
    let size_bytes: Option<i64> = std::fs::metadata(&args.zip_path)
        .ok()
        .map(|m| m.len() as i64);

    conn.execute(
        "INSERT INTO inventory_items
         (id, name, author, source, source_id, local_path, thumbnail_url, download_date,
          size_bytes, is_compressed, display_name, folder_id, is_multi_avatar)
         VALUES (?1,?2,?3,'local',?4,?5,?6,?7,?8,0,?2,?9,1)",
        params![
            item_id,
            args.name,
            args.author,
            args.booth_id,
            args.zip_path,
            args.thumbnail_url,
            now,
            size_bytes,
            args.folder_id,
        ],
    )?;

    for (i, variant) in args.variants.iter().enumerate() {
        let vid = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO inventory_item_variants
             (id, item_id, label, is_materials, sub_zip_name, sort_order)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                vid,
                item_id,
                variant.label,
                variant.is_materials,
                variant.sub_zip_name,
                i as i64,
            ],
        )?;
    }

    // Store product images if any
    if !args.product_images.is_empty() {
        for (i, url) in args.product_images.iter().enumerate() {
            conn.execute(
                "INSERT OR IGNORE INTO item_product_images (item_id, url, sort_order)
                 VALUES (?1, ?2, ?3)",
                params![item_id, url, i as i64],
            ).ok(); // ignore if table doesn't have this shape
        }
    }

    Ok(item_id)
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/multi_avatar.rs
git commit -m "feat(multi-avatar): import_multi_avatar_package command"
```

---

## Task 4: Rust — variant management (delete, compress, decompress)

**Files:**
- Modify: `src-tauri/src/commands/multi_avatar.rs`

- [ ] **Step 1: Add helper that rewrites a container zip, removing or replacing one entry**

Append to `multi_avatar.rs`:

```rust
/// Rewrites the container zip at `zip_path` replacing the bytes of `entry_name`
/// with `new_bytes`. If `new_bytes` is None, the entry is deleted entirely.
fn rewrite_zip_entry(
    zip_path: &str,
    entry_name: &str,
    new_bytes: Option<Vec<u8>>,
    compression: zip::CompressionMethod,
) -> Result<(), String> {
    use std::io::Write;

    let original = std::fs::read(zip_path)
        .map_err(|e| format!("Cannot read zip: {e}"))?;
    let mut old_archive = ZipArchive::new(std::io::Cursor::new(&original))
        .map_err(|e| format!("Invalid zip: {e}"))?;

    let tmp_path = format!("{}.tmp", zip_path);
    let out_file = std::fs::File::create(&tmp_path)
        .map_err(|e| format!("Cannot create tmp file: {e}"))?;
    let mut writer = zip::ZipWriter::new(out_file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for i in 0..old_archive.len() {
        let mut entry = old_archive
            .by_index(i)
            .map_err(|e| format!("Zip read error: {e}"))?;
        let name = entry.name().to_string();

        if name == entry_name {
            if let Some(ref bytes) = new_bytes {
                // Replace with new bytes
                let opts = zip::write::FileOptions::default()
                    .compression_method(compression);
                writer
                    .start_file(&name, opts)
                    .map_err(|e| format!("Zip write error: {e}"))?;
                writer
                    .write_all(bytes)
                    .map_err(|e| format!("Zip write error: {e}"))?;
            }
            // If new_bytes is None, skip (delete the entry)
        } else {
            // Copy unchanged
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("Zip read error: {e}"))?;
            writer
                .start_file(&name, options)
                .map_err(|e| format!("Zip write error: {e}"))?;
            writer
                .write_all(&buf)
                .map_err(|e| format!("Zip write error: {e}"))?;
        }
    }

    writer
        .finish()
        .map_err(|e| format!("Zip finish error: {e}"))?;

    std::fs::rename(&tmp_path, zip_path)
        .map_err(|e| format!("Cannot replace zip: {e}"))?;

    Ok(())
}

/// Deletes a variant: removes DB row + removes entry from container zip.
#[tauri::command]
pub async fn delete_variant(
    pool: State<'_, DbPool>,
    item_id: String,
    variant_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;

    // Fetch sub_zip_name and parent zip_path before deleting
    let (sub_zip_name, zip_path): (String, String) = conn.query_row(
        "SELECT v.sub_zip_name, i.local_path
         FROM inventory_item_variants v
         JOIN inventory_items i ON i.id = v.item_id
         WHERE v.id = ?1 AND v.item_id = ?2",
        params![variant_id, item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tokio::task::spawn_blocking(move || {
        rewrite_zip_entry(&zip_path, &sub_zip_name, None, zip::CompressionMethod::Deflated)
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(|e| AppError::External(e))?;

    conn.execute(
        "DELETE FROM inventory_item_variants WHERE id = ?1",
        params![variant_id],
    )?;

    Ok(())
}

/// Compresses a variant sub-zip in place using Deflated (max level).
#[tauri::command]
pub async fn compress_variant(
    pool: State<'_, DbPool>,
    item_id: String,
    variant_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let (sub_zip_name, zip_path): (String, String) = conn.query_row(
        "SELECT v.sub_zip_name, i.local_path
         FROM inventory_item_variants v
         JOIN inventory_items i ON i.id = v.item_id
         WHERE v.id = ?1 AND v.item_id = ?2",
        params![variant_id, item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        // Extract current bytes
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Cannot open zip: {e}"))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;
        let mut entry = archive
            .by_name(&sub_zip_name)
            .map_err(|_| format!("Entry not found: {sub_zip_name}"))?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("Read error: {e}"))?;
        drop(entry);
        drop(archive);

        // Rewrite with Deflated compression
        rewrite_zip_entry(&zip_path, &sub_zip_name, Some(bytes), zip::CompressionMethod::Deflated)
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(|e| AppError::External(e))?;

    Ok(())
}

/// Decompresses a variant sub-zip in place (stores uncompressed).
#[tauri::command]
pub async fn decompress_variant(
    pool: State<'_, DbPool>,
    item_id: String,
    variant_id: String,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let (sub_zip_name, zip_path): (String, String) = conn.query_row(
        "SELECT v.sub_zip_name, i.local_path
         FROM inventory_item_variants v
         JOIN inventory_items i ON i.id = v.item_id
         WHERE v.id = ?1 AND v.item_id = ?2",
        params![variant_id, item_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let file = std::fs::File::open(&zip_path)
            .map_err(|e| format!("Cannot open zip: {e}"))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("Invalid zip: {e}"))?;
        let mut entry = archive
            .by_name(&sub_zip_name)
            .map_err(|_| format!("Entry not found: {sub_zip_name}"))?;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("Read error: {e}"))?;
        drop(entry);
        drop(archive);

        rewrite_zip_entry(&zip_path, &sub_zip_name, Some(bytes), zip::CompressionMethod::Stored)
    })
    .await
    .map_err(|e| AppError::External(e.to_string()))?
    .map_err(|e| AppError::External(e))?;

    Ok(())
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/multi_avatar.rs
git commit -m "feat(multi-avatar): delete_variant, compress_variant, decompress_variant"
```

---

## Task 5: Rust — migration commands

**Files:**
- Modify: `src-tauri/src/commands/multi_avatar.rs`

- [ ] **Step 1: Add `create_migration_backup` and `create_container_zip`**

Append to `multi_avatar.rs`:

```rust
/// Copies the SQLite DB file and all inventory zip files to a timestamped backup folder.
/// Returns the backup directory path.
#[tauri::command]
pub async fn create_migration_backup(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_dir = data_dir.join("backups").join(&timestamp);
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Cannot create backup dir: {e}"))?;

    // Copy DB file
    let db_path = data_dir.join("vrcstudio.db");
    if db_path.exists() {
        std::fs::copy(&db_path, backup_dir.join("vrcstudio.db"))
            .map_err(|e| format!("Cannot backup DB: {e}"))?;
    }

    // Copy all .zip files in the inventory directory
    let inventory_dir = data_dir.join("inventory");
    if inventory_dir.exists() {
        let zip_backup = backup_dir.join("inventory");
        std::fs::create_dir_all(&zip_backup)
            .map_err(|e| format!("Cannot create inventory backup dir: {e}"))?;
        for entry in std::fs::read_dir(&inventory_dir)
            .map_err(|e| format!("Cannot read inventory dir: {e}"))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("zip") {
                let filename = path.file_name().unwrap().to_string_lossy().to_string();
                std::fs::copy(&path, zip_backup.join(&filename))
                    .map_err(|e| format!("Cannot backup {filename}: {e}"))?;
            }
        }
    }

    Ok(backup_dir.to_string_lossy().to_string())
}

/// Creates a new zip container whose top-level entries are the files at `source_paths`.
/// Each file is added using its filename only (no directory structure).
#[tauri::command]
pub async fn create_container_zip(
    source_paths: Vec<String>,
    output_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        use std::io::Write;

        let out_file = std::fs::File::create(&output_path)
            .map_err(|e| format!("Cannot create output zip: {e}"))?;
        let mut writer = zip::ZipWriter::new(out_file);
        let options = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for src in &source_paths {
            let filename = Path::new(src)
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| format!("Invalid path: {src}"))?;

            let bytes = std::fs::read(src)
                .map_err(|e| format!("Cannot read {src}: {e}"))?;

            writer
                .start_file(filename, options)
                .map_err(|e| format!("Zip write error: {e}"))?;
            writer
                .write_all(&bytes)
                .map_err(|e| format!("Zip write error: {e}"))?;
        }

        writer.finish().map_err(|e| format!("Zip finish error: {e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/multi_avatar.rs
git commit -m "feat(multi-avatar): create_migration_backup, create_container_zip"
```

---

## Task 6: Wire commands into mod.rs and lib.rs

**Files:**
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `pub mod multi_avatar;` to `commands/mod.rs`**

Append after the last `pub mod` line:

```rust
pub mod multi_avatar;
```

- [ ] **Step 2: Register all 8 commands in `src-tauri/src/lib.rs`**

Find the `generate_handler![` block and add the 8 new commands (find a nearby existing command like `delete_inventory_folder` to insert after):

```rust
            commands::multi_avatar::list_zip_contents,
            commands::multi_avatar::extract_sub_zip_to_temp,
            commands::multi_avatar::get_item_variants,
            commands::multi_avatar::import_multi_avatar_package,
            commands::multi_avatar::delete_variant,
            commands::multi_avatar::compress_variant,
            commands::multi_avatar::decompress_variant,
            commands::multi_avatar::create_migration_backup,
            commands::multi_avatar::create_container_zip,
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(multi-avatar): register all commands"
```

---

## Task 7: TypeScript — types and tauri.ts wrappers

**Files:**
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add `ItemVariant` type and all command wrappers**

Find the section near other inventory types (e.g., near `InventoryItem`) and add:

```ts
// ── Multi-avatar ──────────────────────────────────────────────────────────────

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

export interface VariantArg {
  label: string;
  is_materials: boolean;
  sub_zip_name: string;
}

export interface ImportMultiAvatarArgs {
  zip_path: string;
  name: string;
  author?: string;
  thumbnail_url?: string;
  booth_id?: string;
  product_images: string[];
  variants: VariantArg[];
  folder_id?: string;
}

export const tauriListZipContents = (zipPath: string): Promise<string[]> =>
  invoke("list_zip_contents", { zipPath });

export const tauriExtractSubZipToTemp = (zipPath: string, subZipName: string): Promise<string> =>
  invoke("extract_sub_zip_to_temp", { zipPath, subZipName });

export const tauriGetItemVariants = (itemId: string): Promise<ItemVariant[]> =>
  invoke("get_item_variants", { itemId });

export const tauriImportMultiAvatarPackage = (args: ImportMultiAvatarArgs): Promise<string> =>
  invoke("import_multi_avatar_package", { args });

export const tauriDeleteVariant = (itemId: string, variantId: string): Promise<void> =>
  invoke("delete_variant", { itemId, variantId });

export const tauriCompressVariant = (itemId: string, variantId: string): Promise<void> =>
  invoke("compress_variant", { itemId, variantId });

export const tauriDecompressVariant = (itemId: string, variantId: string): Promise<void> =>
  invoke("decompress_variant", { itemId, variantId });

export const tauriCreateMigrationBackup = (): Promise<string> =>
  invoke("create_migration_backup");

export const tauriCreateContainerZip = (sourcePaths: string[], outputPath: string): Promise<void> =>
  invoke("create_container_zip", { sourcePaths, outputPath });
```

Also add `is_multi_avatar?: boolean` to the existing `InventoryItem` interface in `tauri.ts`.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tauri.ts
git commit -m "feat(multi-avatar): TypeScript types + tauri.ts wrappers"
```

---

## Task 8: ImportLocalDialog — mode picker + variant mapping

**Files:**
- Modify: `src/components/inventory/ImportLocalDialog.tsx`

- [ ] **Step 1: Add mode state and imports**

At the top of the component (near other `useState` declarations), add:

```ts
import { tauriListZipContents, tauriImportMultiAvatarPackage, VariantArg } from "../../lib/tauri";

// Inside the component:
const [importMode, setImportMode] = useState<"single" | "multi">("single");
const [zipEntries, setZipEntries] = useState<string[]>([]);
const [variantRows, setVariantRows] = useState<Array<{ label: string; subZipName: string; isMaterials: boolean }>>([]);
const [loadingEntries, setLoadingEntries] = useState(false);
```

- [ ] **Step 2: Load zip entries when zip is picked in multi mode**

In the `pickFile` function, after `setZipPath(result)`, add:

```ts
if (importMode === "multi") {
  setLoadingEntries(true);
  try {
    const entries = await tauriListZipContents(result);
    setZipEntries(entries);
    // Auto-detect variants from filenames
    const autoRows = entries.map((filename) => {
      const detected = detectAvatarVariants(filename);
      const avatarName = detected?.variants[0]?.avatarName ?? "";
      const isMaterials = detected?.variants[0]?.isMaterials ?? false;
      return { label: avatarName || filename, subZipName: filename, isMaterials };
    });
    setVariantRows(autoRows);
  } catch {
    setZipEntries([]);
  } finally {
    setLoadingEntries(false);
  }
}
```

Also add the same logic when `preselectedFile` changes (in the `useEffect` for `preselectedFile`).

- [ ] **Step 3: Add mode picker UI**

Inside the modal body, as the very first element after the `<div className="p-5 flex flex-col gap-5 overflow-y-auto">` opening tag, add:

```tsx
{/* ── Import mode picker ── */}
<div className="flex gap-2">
  <button
    onClick={() => setImportMode("single")}
    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
      importMode === "single"
        ? "border-red-600 bg-red-600/10 text-red-300"
        : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
    }`}
  >
    <Package className="h-3.5 w-3.5" />
    Single Avatar
  </button>
  <button
    onClick={() => setImportMode("multi")}
    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
      importMode === "multi"
        ? "border-violet-600 bg-violet-600/10 text-violet-300"
        : "border-zinc-700 bg-zinc-900 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
    }`}
  >
    <Users className="h-3.5 w-3.5" />
    Multi Avatar
    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-900/60 text-violet-300 border border-violet-700/50 font-bold tracking-wide uppercase">
      BETA
    </span>
  </button>
</div>
```

- [ ] **Step 4: Add Variant Mapping section (only shown in multi mode)**

After the file picker section (after the `</div>` that closes the zip picker), add:

```tsx
{/* ── Variant Mapping (multi mode only) ── */}
{importMode === "multi" && zipPath && (
  <div className="flex flex-col gap-3">
    <div className="flex items-center justify-between">
      <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
        <Users className="h-3 w-3" />
        Variants
      </label>
      <div className="flex gap-1.5">
        <button
          onClick={() => setVariantRows([...variantRows, { label: "", subZipName: zipEntries[0] ?? "", isMaterials: false }])}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-[10px] transition-colors"
        >
          <Plus className="h-3 w-3" /> Add variant
        </button>
        <button
          onClick={() => setVariantRows([...variantRows, { label: "Materials", subZipName: zipEntries[0] ?? "", isMaterials: true }])}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-lime-900/30 hover:bg-lime-900/50 border border-lime-700/50 text-lime-300 text-[10px] transition-colors"
        >
          <Layers className="h-3 w-3" /> + Materials
        </button>
      </div>
    </div>

    {loadingEntries ? (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning zip…
      </div>
    ) : variantRows.length === 0 ? (
      <p className="text-xs text-zinc-600 italic">No variants yet. Add one or pick a zip above.</p>
    ) : (
      <div className="flex flex-col gap-2">
        {variantRows.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              value={row.label}
              onChange={(e) => {
                const next = [...variantRows];
                next[idx] = { ...next[idx], label: e.target.value };
                setVariantRows(next);
              }}
              placeholder="Avatar name"
              className={`w-28 px-2 py-1.5 rounded-lg bg-zinc-900 border text-xs outline-none transition-colors ${
                row.isMaterials ? "border-lime-700/50 text-lime-300" : "border-zinc-700 text-zinc-200 focus:border-zinc-500"
              }`}
            />
            <select
              value={row.subZipName}
              onChange={(e) => {
                const next = [...variantRows];
                next[idx] = { ...next[idx], subZipName: e.target.value };
                setVariantRows(next);
              }}
              className="flex-1 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 outline-none focus:border-zinc-500 transition-colors"
            >
              {zipEntries.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
            <button
              onClick={() => setVariantRows(variantRows.filter((_, i) => i !== idx))}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Wire the Import button to call the right command**

Replace the `handleImportClick` function to branch on mode:

```ts
const handleImportClick = async () => {
  if (!zipPath || !name.trim()) return;
  setImportError(null);
  setDuplicateCheck(null);
  setImporting(true);

  try {
    if (importMode === "multi") {
      if (variantRows.length === 0) {
        setImportError("Add at least one variant before importing.");
        setImporting(false);
        return;
      }
      const newId = await tauriImportMultiAvatarPackage({
        zip_path: zipPath,
        name: name.trim(),
        author: author.trim() || undefined,
        thumbnail_url: thumbnailUrl.trim() || boothDetail?.images[0] || undefined,
        booth_id: extractBoothId(boothInput) ?? undefined,
        product_images: detailImages,
        variants: variantRows.map((r) => ({
          label: r.label || r.subZipName,
          is_materials: r.isMaterials,
          sub_zip_name: r.subZipName,
        })),
      });
      setImportedId(newId);
      onImported?.(newId);
      return;
    }

    // Single mode — existing duplicate-check flow
    const result = await tauriCheckDuplicateItems(name.trim(), zipPath);
    if (result.exists) {
      setDuplicateCheck(result);
      setImporting(false);
    } else {
      await handleImport(false);
    }
  } catch (e) {
    setImportError(String(e));
    setImporting(false);
  }
};
```

Also add `Layers` to the lucide imports at the top if not already present.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/ImportLocalDialog.tsx
git commit -m "feat(multi-avatar): import mode picker + variant mapping in ImportLocalDialog"
```

---

## Task 9: VersionsTab component

**Files:**
- Create: `src/components/inventory/VersionsTab.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/inventory/VersionsTab.tsx
import { useState, useEffect, useCallback } from "react";
import {
  Users, Layers, ChevronDown, ChevronUp, Loader2,
  ExternalLink, Trash2, Archive, PackageOpen, MoreHorizontal, AlertTriangle,
} from "lucide-react";
import {
  ItemVariant,
  tauriGetItemVariants,
  tauriExtractSubZipToTemp,
  tauriDeleteVariant,
  tauriCompressVariant,
  tauriDecompressVariant,
  tauriGetFileTree,
  FileNode,
} from "../../lib/tauri";
import { FileTreeViewer } from "./FileTreeViewver"; // note: existing filename has typo, keep it
import { OpenInUnityModal } from "./OpenInUnityModal";

interface Props {
  itemId: string;
  itemZipPath: string;
}

function formatBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

function VariantRow({ variant, itemId, onDeleted }: {
  variant: ItemVariant;
  itemId: string;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tree, setTree] = useState<FileNode[] | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [openInUnityPath, setOpenInUnityPath] = useState<string | null>(null);
  const [isCompressed, setIsCompressed] = useState(variant.is_compressed);

  const loadTree = useCallback(async () => {
    if (tree !== null) return;
    setTreeLoading(true);
    try {
      const extracted = await tauriExtractSubZipToTemp(
        variant.item_id, // we pass item_id, not zip_path, because the command needs item context
        variant.sub_zip_name
      );
      const nodes = await tauriGetFileTree(extracted);
      setTree(nodes);
    } catch {
      setTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, [tree, variant]);

  const handleOpen = async () => {
    setActionLoading(true);
    try {
      // extract_sub_zip_to_temp takes (zip_path, sub_zip_name) — we need item's local_path
      // The parent passes itemZipPath; we'll use a context approach below
      const path = await tauriExtractSubZipToTemp(itemId, variant.sub_zip_name);
      setOpenInUnityPath(path);
    } catch (e) {
      console.error("Extract failed", e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    setActionLoading(true);
    try {
      await tauriDeleteVariant(itemId, variant.id);
      onDeleted();
    } catch (e) {
      console.error("Delete failed", e);
    } finally {
      setActionLoading(false);
      setConfirmDelete(false);
    }
  };

  const handleCompress = async () => {
    setActionLoading(true);
    try {
      await tauriCompressVariant(itemId, variant.id);
      setIsCompressed(true);
    } catch (e) {
      console.error("Compress failed", e);
    } finally {
      setActionLoading(false);
      setMenuOpen(false);
    }
  };

  const handleDecompress = async () => {
    setActionLoading(true);
    try {
      await tauriDecompressVariant(itemId, variant.id);
      setIsCompressed(false);
    } catch (e) {
      console.error("Decompress failed", e);
    } finally {
      setActionLoading(false);
      setMenuOpen(false);
    }
  };

  const handleExpandToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadTree();
  };

  const Icon = variant.is_materials ? Layers : Users;

  return (
    <>
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        {/* Row header */}
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-800/40 transition-colors"
          onClick={handleExpandToggle}
        >
          <Icon className={`h-4 w-4 shrink-0 ${variant.is_materials ? "text-lime-400" : "text-violet-400"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-100">{variant.label}</span>
              {isCompressed && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 border border-amber-700/50 font-bold uppercase tracking-wide">
                  ZIP
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-600 font-mono truncate">{variant.sub_zip_name}</p>
          </div>
          <span className="text-[11px] text-zinc-500 shrink-0">{formatBytes(variant.size_bytes)}</span>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleOpen}
              disabled={actionLoading}
              title="Open in Unity"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 hover:text-white text-[11px] transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
              Open
            </button>
            <div className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-40 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl py-1 overflow-hidden">
                  {isCompressed ? (
                    <button
                      onClick={handleDecompress}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-blue-300 hover:bg-zinc-800 transition-colors"
                    >
                      <PackageOpen className="h-3.5 w-3.5 shrink-0" /> Decompress
                    </button>
                  ) : (
                    <button
                      onClick={handleCompress}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-300 hover:bg-zinc-800 transition-colors"
                    >
                      <Archive className="h-3.5 w-3.5 shrink-0" /> Compress
                    </button>
                  )}
                  <div className="border-t border-zinc-800 my-1" />
                  <button
                    onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-zinc-800 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>

          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
          )}
        </div>

        {/* Expanded: file tree */}
        {expanded && (
          <div className="border-t border-zinc-800 px-4 py-3">
            {treeLoading ? (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading file tree…
              </div>
            ) : tree && tree.length > 0 ? (
              <FileTreeViewer nodes={tree} />
            ) : (
              <p className="text-xs text-zinc-600 italic">No files found.</p>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-80 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-zinc-100">Remove "{variant.label}"?</p>
                <p className="text-xs text-zinc-400 mt-1">
                  This will permanently delete <span className="font-mono text-zinc-300">{variant.sub_zip_name}</span> from the container. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {openInUnityPath && (
        <OpenInUnityModal
          items={[{ id: variant.id, name: variant.label, local_path: openInUnityPath } as any]}
          onClose={() => setOpenInUnityPath(null)}
        />
      )}
    </>
  );
}

export function VersionsTab({ itemId, itemZipPath }: Props) {
  const [variants, setVariants] = useState<ItemVariant[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tauriGetItemVariants(itemId);
      setVariants(data);
    } catch {
      setVariants([]);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (variants.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">
        No variants found.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {variants.map((v) => (
        <VariantRow
          key={v.id}
          variant={v}
          itemId={itemId}
          onDeleted={() => setVariants((prev) => prev.filter((x) => x.id !== v.id))}
        />
      ))}
    </div>
  );
}
```

**Important note on `tauriExtractSubZipToTemp`:** The command takes `(zip_path, sub_zip_name)` but in `VersionsTab` we only have `itemId`. Update the `handleOpen` to use `itemZipPath` from props:

```ts
const path = await tauriExtractSubZipToTemp(itemZipPath, variant.sub_zip_name);
```

And in the `loadTree` function:
```ts
const extracted = await tauriExtractSubZipToTemp(itemZipPath, variant.sub_zip_name);
```

Make `itemZipPath` available in `VariantRow` by adding it to `VariantRow`'s props:
```ts
function VariantRow({ variant, itemId, itemZipPath, onDeleted }: {
  variant: ItemVariant;
  itemId: string;
  itemZipPath: string;
  onDeleted: () => void;
})
```

And pass it from `VersionsTab`:
```tsx
<VariantRow key={v.id} variant={v} itemId={itemId} itemZipPath={itemZipPath} onDeleted={...} />
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Fix any errors (likely `FileTreeViewer` props or `OpenInUnityModal` props — adjust the `items` prop to match the component's actual interface).

- [ ] **Step 3: Commit**

```bash
git add src/components/inventory/VersionsTab.tsx
git commit -m "feat(multi-avatar): VersionsTab component"
```

---

## Task 10: Add Versions tab to InventoryItemDetail

**Files:**
- Modify: `src/components/inventory/InventoryItemDetail.tsx`

- [ ] **Step 1: Add "versions" to Tab type**

Find:
```ts
type Tab = "overview" | "files" | "3d";
```
Replace with:
```ts
type Tab = "overview" | "files" | "3d" | "versions";
```

- [ ] **Step 2: Add Versions tab to the tab list**

Find the tab definitions array (around line 611):
```ts
{ id: "overview", label: t("inventory_detail_tab_overview"), icon: Info },
{ id: "files",    label: t("inventory_detail_tab_files"),    icon: FileArchive },
{ id: "3d",       label: t("inventory_detail_tab_3d"), icon: Box, beta: true },
```

Replace with:
```ts
{ id: "overview",  label: t("inventory_detail_tab_overview"), icon: Info },
{ id: "files",     label: t("inventory_detail_tab_files"),    icon: FileArchive },
{ id: "3d",        label: t("inventory_detail_tab_3d"),        icon: Box, beta: true },
...(item.is_multi_avatar
  ? [{ id: "versions" as Tab, label: "Versions", icon: Layers, beta: true }]
  : []),
```

Add `Layers` to the lucide imports if not present.

- [ ] **Step 3: Add Versions tab content**

Find the block after `{tab === "3d" && (` and after its closing `)}`, add:

```tsx
{tab === "versions" && item.is_multi_avatar && (
  <div className="p-4">
    <VersionsTab itemId={item.id} itemZipPath={item.local_path} />
  </div>
)}
```

- [ ] **Step 4: Add import**

At the top of `InventoryItemDetail.tsx`, add:
```ts
import { VersionsTab } from "./VersionsTab";
```

Also make sure `InventoryItem` has `local_path` in the TypeScript interface (it's `local_path` in the Rust model — verify this is exposed in `tauri.ts`'s `InventoryItem` interface; if it's named differently, use the correct field name).

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/inventory/InventoryItemDetail.tsx
git commit -m "feat(multi-avatar): Versions tab in InventoryItemDetail"
```

---

## Task 11: MigrationPopup + MigrationWizard

**Files:**
- Create: `src/components/inventory/MigrationPopup.tsx`
- Create: `src/components/inventory/MigrationWizard.tsx`

- [ ] **Step 1: Create MigrationPopup.tsx**

```tsx
// src/components/inventory/MigrationPopup.tsx
import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { MigrationWizard } from "./MigrationWizard";

const DISMISSED_KEY = "multi_avatar_migration_dismissed";

interface Props {
  hasItems: boolean;
}

export function MigrationPopup({ hasItems }: Props) {
  const [visible, setVisible] = useState(
    hasItems && localStorage.getItem(DISMISSED_KEY) !== "true"
  );
  const [showWizard, setShowWizard] = useState(false);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "true");
    setVisible(false);
  };

  return (
    <>
      {/* Popup */}
      {!showWizard && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-5 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
              <p className="text-sm font-semibold text-zinc-100">New: Multi-Avatar Packages</p>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-900/60 text-violet-300 border border-violet-700/50 font-bold tracking-wide uppercase shrink-0">
                BETA
              </span>
            </div>
            <button onClick={dismiss} className="h-5 w-5 flex items-center justify-center text-zinc-600 hover:text-zinc-300 shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            You can now group avatar variants (Karin, Sio, Materials…) under a single inventory item.
            The Migration Wizard can help you reorganise your existing library. A backup is created automatically before any changes are made.
          </p>
          <div className="flex gap-2 justify-end pt-1">
            <button
              onClick={dismiss}
              className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              Don't show again
            </button>
            <button
              onClick={() => setShowWizard(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
            >
              Start Migration →
            </button>
          </div>
        </div>
      )}

      {showWizard && (
        <MigrationWizard onClose={() => { setShowWizard(false); setVisible(false); }} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Create MigrationWizard.tsx**

```tsx
// src/components/inventory/MigrationWizard.tsx
import { useState, useCallback } from "react";
import {
  X, Loader2, CheckCircle, AlertTriangle,
  Users, Layers, Package, ChevronRight,
} from "lucide-react";
import { useInventoryStore } from "../../store/inventoryStore";
import {
  tauriCreateMigrationBackup,
  tauriCreateContainerZip,
  tauriImportMultiAvatarPackage,
  tauriDeleteInventoryItem,
  VariantArg,
} from "../../lib/tauri";
import { detectAvatarVariants } from "./ImportLocalDialog";
import { InventoryItem } from "../../lib/tauri";

type Step = "backup" | "select" | "configure" | "done";

interface GroupConfig {
  name: string;
  author: string;
  thumbnailUrl: string;
  variantRows: Array<{ item: InventoryItem; label: string; isMaterials: boolean }>;
}

interface Props {
  onClose: () => void;
}

export function MigrationWizard({ onClose }: Props) {
  const { items, fetchAll } = useInventoryStore();
  const [step, setStep] = useState<Step>("backup");

  // Backup step
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Select step
  const [migratedIds, setMigratedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Configure step
  const [groupConfig, setGroupConfig] = useState<GroupConfig | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Done
  const [groupCount, setGroupCount] = useState(0);

  const availableItems = items.filter((i) => !migratedIds.has(i.id) && !i.is_multi_avatar);

  // ── Step 1: Backup ────────────────────────────────────────────────────────
  const runBackup = async () => {
    setBackupLoading(true);
    setBackupError(null);
    try {
      const path = await tauriCreateMigrationBackup();
      setBackupPath(path);
      setStep("select");
    } catch (e) {
      setBackupError(String(e));
    } finally {
      setBackupLoading(false);
    }
  };

  // ── Step 2: Select group ──────────────────────────────────────────────────
  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const buildGroupConfig = () => {
    const selected = availableItems.filter((i) => selectedIds.has(i.id));

    // Common name prefix
    const names = selected.map((i) => i.display_name ?? i.name);
    let commonName = names[0] ?? "";
    for (const n of names.slice(1)) {
      let len = 0;
      while (len < commonName.length && len < n.length && commonName[len] === n[len]) len++;
      commonName = commonName.slice(0, len).replace(/[_\s-]+$/, "");
    }

    // Common author
    const authors = [...new Set(selected.map((i) => i.author).filter(Boolean))];
    const author = authors.length === 1 ? authors[0]! : "";

    // Thumbnail from first item
    const thumbnailUrl = selected[0]?.thumbnail_url ?? "";

    // Auto-detect variant labels
    const variantRows = selected.map((item) => {
      const detected = detectAvatarVariants((item.display_name ?? item.name) + ".zip");
      const avatarName = detected?.variants[0]?.avatarName ?? "";
      const isMaterials = detected?.variants[0]?.isMaterials ?? false;
      return { item, label: avatarName || (item.display_name ?? item.name), isMaterials };
    });

    setGroupConfig({ name: commonName, author, thumbnailUrl, variantRows });
    setStep("configure");
  };

  // ── Step 3: Configure + Save ──────────────────────────────────────────────
  const saveGroup = async () => {
    if (!groupConfig) return;
    setSaveLoading(true);
    setSaveError(null);

    try {
      // 1. Create container zip
      const appDataDir = await (await import("@tauri-apps/api/path")).appDataDir();
      const outputPath = `${appDataDir}/inventory/${Date.now()}_container.zip`;
      const sourcePaths = groupConfig.variantRows.map((r) => r.item.local_path);
      await tauriCreateContainerZip(sourcePaths, outputPath);

      // 2. Import as multi-avatar
      const variants: VariantArg[] = groupConfig.variantRows.map((r, i) => ({
        label: r.label || r.item.name,
        is_materials: r.isMaterials,
        sub_zip_name: r.item.local_path.split(/[/\\]/).pop() ?? `variant_${i}.zip`,
      }));

      await tauriImportMultiAvatarPackage({
        zip_path: outputPath,
        name: groupConfig.name,
        author: groupConfig.author || undefined,
        thumbnail_url: groupConfig.thumbnailUrl || undefined,
        product_images: [],
        variants,
      });

      // 3. Delete originals
      for (const row of groupConfig.variantRows) {
        await tauriDeleteInventoryItem(row.item.id, "InventoryAndDisk").catch(() => {});
      }

      // 4. Mark as migrated
      setMigratedIds((prev) => {
        const next = new Set(prev);
        groupConfig.variantRows.forEach((r) => next.add(r.item.id));
        return next;
      });
      setGroupCount((c) => c + 1);
      setSelectedIds(new Set());
      setGroupConfig(null);
      await fetchAll();
      setStep("done");
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Package className="h-5 w-5 text-violet-400" />
            <h2 className="text-base font-semibold text-zinc-100">Migration Wizard</h2>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-900/60 text-violet-300 border border-violet-700/50 font-bold tracking-wide uppercase">
              BETA
            </span>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5 overflow-y-auto flex-1">

          {/* ── Step 1: Backup ── */}
          {step === "backup" && (
            <div className="flex flex-col gap-4">
              <div className="p-4 rounded-xl bg-violet-950/30 border border-violet-800/40">
                <p className="text-sm font-semibold text-violet-200 mb-1">Step 1 — Create backup</p>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Before making any changes, a full backup of your inventory database and zip files will be created automatically.
                  This cannot be skipped.
                </p>
              </div>
              {backupError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-900/50 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {backupError}
                </div>
              )}
              <button
                onClick={runBackup}
                disabled={backupLoading}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {backupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {backupLoading ? "Creating backup…" : "Create backup & continue"}
              </button>
            </div>
          )}

          {/* ── Step 2: Select items ── */}
          {step === "select" && (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-semibold text-zinc-100 mb-1">Step 2 — Select items to group</p>
                <p className="text-xs text-zinc-400">Select all inventory items that belong to the same outfit or asset (e.g. Karin version, Sio version, Materials).</p>
              </div>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {availableItems.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic py-4 text-center">No items available to migrate.</p>
                ) : availableItems.map((item) => (
                  <label key={item.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${selectedIds.has(item.id) ? "bg-violet-900/30 border border-violet-700/50" : "hover:bg-zinc-800/60 border border-transparent"}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="accent-violet-500"
                    />
                    {item.thumbnail_url && (
                      <img src={item.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-200 truncate">{item.display_name ?? item.name}</p>
                      {item.author && <p className="text-[10px] text-zinc-500 truncate">{item.author}</p>}
                    </div>
                  </label>
                ))}
              </div>
              <button
                onClick={buildGroupConfig}
                disabled={selectedIds.size < 2}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Group selected items <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Step 3: Configure ── */}
          {step === "configure" && groupConfig && (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-semibold text-zinc-100">Step 3 — Configure group</p>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Name</label>
                <input
                  value={groupConfig.name}
                  onChange={(e) => setGroupConfig({ ...groupConfig, name: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Author (optional)</label>
                <input
                  value={groupConfig.author}
                  onChange={(e) => setGroupConfig({ ...groupConfig, author: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 focus:border-zinc-500 text-xs text-zinc-200 outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Variants</label>
                {groupConfig.variantRows.map((row, idx) => (
                  <div key={row.item.id} className="flex items-center gap-2">
                    <div className="w-6 h-6 flex items-center justify-center shrink-0">
                      {row.isMaterials
                        ? <Layers className="h-3.5 w-3.5 text-lime-400" />
                        : <Users className="h-3.5 w-3.5 text-violet-400" />
                      }
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono truncate w-32 shrink-0">
                      {row.item.display_name ?? row.item.name}
                    </span>
                    <input
                      value={row.label}
                      onChange={(e) => {
                        const next = [...groupConfig.variantRows];
                        next[idx] = { ...next[idx], label: e.target.value };
                        setGroupConfig({ ...groupConfig, variantRows: next });
                      }}
                      placeholder="Avatar label"
                      className="flex-1 px-2 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={() => {
                        const next = [...groupConfig.variantRows];
                        next[idx] = { ...next[idx], isMaterials: !next[idx].isMaterials };
                        setGroupConfig({ ...groupConfig, variantRows: next });
                      }}
                      className={`text-[9px] px-2 py-1 rounded-lg border font-bold uppercase tracking-wide transition-colors ${row.isMaterials ? "bg-lime-900/40 text-lime-300 border-lime-700/50" : "bg-zinc-800 text-zinc-500 border-zinc-700"}`}
                    >
                      Mat
                    </button>
                  </div>
                ))}
              </div>

              {saveError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-900/20 border border-red-900/50 text-xs text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" /> {saveError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => { setGroupConfig(null); setStep("select"); }}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={saveGroup}
                  disabled={saveLoading || !groupConfig.name.trim()}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                >
                  {saveLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {saveLoading ? "Processing…" : "Save group"}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Done / More? ── */}
          {step === "done" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CheckCircle className="h-10 w-10 text-emerald-400" />
                <p className="text-sm font-semibold text-zinc-100">
                  {groupCount} group{groupCount !== 1 ? "s" : ""} migrated
                </p>
                <p className="text-xs text-zinc-500">
                  {availableItems.length > 0
                    ? `${availableItems.length} items remaining in your library.`
                    : "All items have been processed."}
                </p>
              </div>

              <div className="flex gap-2">
                {availableItems.length > 0 && (
                  <button
                    onClick={() => { setSelectedIds(new Set()); setStep("select"); }}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors"
                  >
                    ← Add another group
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors"
                >
                  Finish →
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Fix any errors (likely around `tauriDeleteInventoryItem` signature — pass `"InventoryAndDisk"` as the second arg matching the existing `DeleteMode` type).

- [ ] **Step 4: Commit**

```bash
git add src/components/inventory/MigrationPopup.tsx src/components/inventory/MigrationWizard.tsx
git commit -m "feat(multi-avatar): MigrationPopup + MigrationWizard"
```

---

## Task 12: Wire MigrationPopup in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import and render MigrationPopup**

Find the imports at the top of `App.tsx` and add:
```ts
import { MigrationPopup } from "@/components/inventory/MigrationPopup";
```

Find the `useInventoryStore` usage (or add it):
```ts
const inventoryItems = useInventoryStore((s) => s.items);
```

In the JSX, add `<MigrationPopup>` as the last child before the closing root element:
```tsx
<MigrationPopup hasItems={inventoryItems.length > 0} />
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(multi-avatar): render MigrationPopup in App"
```

---

## Task 13: Final verification

- [ ] **Step 1: Cargo check**

```bash
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | grep "^error"
```
Expected: no output.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS"
```
Expected: no output.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(multi-avatar): complete multi-avatar packages feature"
```

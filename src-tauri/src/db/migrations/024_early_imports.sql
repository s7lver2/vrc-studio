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

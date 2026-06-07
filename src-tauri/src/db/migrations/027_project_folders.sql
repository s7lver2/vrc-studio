-- Project folders (same pattern as inventory_folders)
CREATE TABLE IF NOT EXISTS project_folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  TEXT REFERENCES project_folders(id) ON DELETE CASCADE,
    color      TEXT,
    sort_order INTEGER,
    emoji      TEXT
);

-- Many-to-one: each project belongs to at most one folder
ALTER TABLE projects ADD COLUMN folder_id TEXT REFERENCES project_folders(id) ON DELETE SET NULL;
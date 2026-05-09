CREATE TABLE IF NOT EXISTS project_journal_entries (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_project ON project_journal_entries(project_id, created_at DESC);
-- Fase 4: VCS Git/GitHub
-- vcs_enabled already exists in projects table (from migration 1)
-- Add only the new column vcs_branch
ALTER TABLE projects ADD COLUMN vcs_branch TEXT NOT NULL DEFAULT 'main';

CREATE TABLE IF NOT EXISTS git_remotes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'origin',
    url         TEXT NOT NULL,
    github_repo TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
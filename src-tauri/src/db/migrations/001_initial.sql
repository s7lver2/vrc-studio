-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    path          TEXT NOT NULL UNIQUE,
    unity_version TEXT NOT NULL,
    unity_type    TEXT NOT NULL CHECK(unity_type IN ('standard', 'custom')),
    avatar_base_id TEXT,
    shader        TEXT CHECK(shader IN ('liltoon', 'poiyomi', NULL)),
    vcs_enabled   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Custom VPM packages
CREATE TABLE IF NOT EXISTS custom_packages (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    version      TEXT NOT NULL,
    description  TEXT,
    json_path    TEXT NOT NULL,
    zip_path     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Inventory items
CREATE TABLE IF NOT EXISTS inventory_items (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    author        TEXT,
    source        TEXT NOT NULL CHECK(source IN ('booth', 'riperstore', 'local')),
    source_id     TEXT,
    local_path    TEXT NOT NULL,
    download_date TEXT NOT NULL DEFAULT (datetime('now')),
    size_bytes    INTEGER,
    tags          TEXT DEFAULT '[]'
);

-- Virtual folders for inventory
CREATE TABLE IF NOT EXISTS inventory_folders (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    parent_id TEXT REFERENCES inventory_folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_folder_items (
    folder_id TEXT NOT NULL REFERENCES inventory_folders(id) ON DELETE CASCADE,
    item_id   TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, item_id)
);

-- Assets installed in projects
CREATE TABLE IF NOT EXISTS project_assets (
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    installed_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, inventory_item_id)
);

-- VPM repositories
CREATE TABLE IF NOT EXISTS vpm_repositories (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL UNIQUE,
    last_fetched TEXT,
    json_cache   TEXT,
    is_official  INTEGER NOT NULL DEFAULT 0
);

-- Linked external accounts (tokens encrypted at app level)
CREATE TABLE IF NOT EXISTS linked_accounts (
    provider        TEXT PRIMARY KEY,
    token_encrypted TEXT NOT NULL,
    username        TEXT,
    expires_at      TEXT
);

-- Insert VRChat official VPM repository (never removable from UI)
INSERT OR IGNORE INTO vpm_repositories (id, name, url, is_official)
VALUES (
    'com.vrchat.repos.official',
    'VRChat Official',
    'https://packages.vrchat.com/official?download',
    1
);
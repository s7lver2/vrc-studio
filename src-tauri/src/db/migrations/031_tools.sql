CREATE TABLE IF NOT EXISTS tools_installed (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    version      TEXT NOT NULL,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    enabled      INTEGER NOT NULL DEFAULT 1,
    metadata     TEXT NOT NULL DEFAULT '{}'
);

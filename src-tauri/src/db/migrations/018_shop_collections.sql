-- src-tauri/src/db/migrations/018_shop_collections.sql
CREATE TABLE IF NOT EXISTS shop_collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    cover_url   TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_collection_items (
    id              TEXT PRIMARY KEY,
    collection_id   TEXT NOT NULL REFERENCES shop_collections(id) ON DELETE CASCADE,
    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    author          TEXT NOT NULL,
    thumbnail_url   TEXT NOT NULL DEFAULT '',
    price_display   TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL DEFAULT '',
    added_at        TEXT NOT NULL,
    UNIQUE(collection_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_items_cid
    ON shop_collection_items(collection_id);
-- src-tauri/src/db/migrations/017_shop_cart.sql
CREATE TABLE IF NOT EXISTS shop_cart (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    author      TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL DEFAULT '',
    price_display TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL DEFAULT '',
    added_at    TEXT NOT NULL,
    UNIQUE(source, source_id)
);
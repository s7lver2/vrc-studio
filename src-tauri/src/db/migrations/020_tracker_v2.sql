-- 020_tracker_v2.sql
-- Añade soporte para kind='keyword' en tracker_items.
-- SQLite no permite modificar CHECK constraints con ALTER TABLE,
-- así que recreamos la tabla con la restricción expandida.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS tracker_items_new (
    id                      TEXT PRIMARY KEY,
    kind                    TEXT NOT NULL CHECK(kind IN ('item', 'author', 'keyword')),
    -- Para kind='item'
    booth_id                TEXT,
    item_name               TEXT,
    item_author             TEXT,
    item_thumbnail_url      TEXT,
    item_url                TEXT,
    last_known_price        TEXT,
    track_price_drops       INTEGER NOT NULL DEFAULT 1,
    track_availability      INTEGER NOT NULL DEFAULT 1,
    -- Para kind='author'
    author_name             TEXT,
    author_booth_shop_id    TEXT,
    track_new_items         INTEGER NOT NULL DEFAULT 1,
    -- Para kind='keyword'
    search_keyword          TEXT,
    search_category         TEXT,
    -- Común
    check_interval_minutes  INTEGER NOT NULL DEFAULT 60,
    last_checked_at         TEXT,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL
);

INSERT INTO tracker_items_new
    SELECT
        id, kind,
        booth_id, item_name, item_author, item_thumbnail_url, item_url,
        last_known_price, track_price_drops, track_availability,
        author_name, author_booth_shop_id, track_new_items,
        NULL AS search_keyword,
        NULL AS search_category,
        check_interval_minutes, last_checked_at, is_active, created_at
    FROM tracker_items;

DROP TABLE tracker_items;
ALTER TABLE tracker_items_new RENAME TO tracker_items;

-- Re-crear los índices
CREATE INDEX IF NOT EXISTS idx_tracker_events_item
    ON tracker_events(tracker_item_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracker_events_unread
    ON tracker_events(is_read, detected_at DESC);

PRAGMA foreign_keys = ON;
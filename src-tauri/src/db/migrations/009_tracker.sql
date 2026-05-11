-- 009_tracker.sql
CREATE TABLE IF NOT EXISTS tracker_items (
    id                      TEXT PRIMARY KEY,
    kind                    TEXT NOT NULL CHECK(kind IN ('item','author')),
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
    -- Común
    check_interval_minutes  INTEGER NOT NULL DEFAULT 60,
    last_checked_at         TEXT,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker_events (
    id               TEXT PRIMARY KEY,
    tracker_item_id  TEXT NOT NULL REFERENCES tracker_items(id) ON DELETE CASCADE,
    event_type       TEXT NOT NULL,  -- 'price_drop'|'back_in_stock'|'new_item'|'price_change'
    payload          TEXT NOT NULL DEFAULT '{}',  -- JSON con detalles
    detected_at      TEXT NOT NULL,
    is_read          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tracker_events_item
    ON tracker_events(tracker_item_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracker_events_unread
    ON tracker_events(is_read, detected_at DESC);
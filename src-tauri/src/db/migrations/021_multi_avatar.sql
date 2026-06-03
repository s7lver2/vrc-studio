ALTER TABLE inventory_items ADD COLUMN is_multi_avatar INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_item_variants (
    id           TEXT    PRIMARY KEY,
    item_id      TEXT    NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    label        TEXT    NOT NULL,
    is_materials INTEGER NOT NULL DEFAULT 0,
    sub_zip_name TEXT    NOT NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Añade soporte de subcarpetas y orden personalizado a colecciones e items.
-- SQLite no permite ADD COLUMN ... REFERENCES con FOREIGN KEY enforcement
-- en ALTER TABLE, así que la integridad referencial se gestiona desde Rust.
ALTER TABLE shop_collections ADD COLUMN parent_id   TEXT;
ALTER TABLE shop_collections ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shop_collection_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

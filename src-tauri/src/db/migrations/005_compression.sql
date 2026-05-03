-- Track whether an inventory item has been compressed with aggressive zip compression
ALTER TABLE inventory_items ADD COLUMN is_compressed INTEGER NOT NULL DEFAULT 0;
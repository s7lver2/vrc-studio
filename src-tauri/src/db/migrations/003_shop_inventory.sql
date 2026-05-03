-- Add thumbnail_url column to inventory_items (not present in 001)
ALTER TABLE inventory_items ADD COLUMN thumbnail_url TEXT;
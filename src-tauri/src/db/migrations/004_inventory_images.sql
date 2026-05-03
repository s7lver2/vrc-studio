-- Add product_images column to inventory_items to cache booth/riperstore images
ALTER TABLE inventory_items ADD COLUMN product_images TEXT DEFAULT '[]';
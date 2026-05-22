-- 014_folder_sort_order.sql
ALTER TABLE inventory_folders ADD COLUMN sort_order INTEGER;
-- Assign initial order equal to rowid so existing folders keep their current order
UPDATE inventory_folders SET sort_order = rowid WHERE sort_order IS NULL;
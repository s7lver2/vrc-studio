-- 010_inventory_v2.sql
-- display_name: nombre personalizado que override "name" en UI
-- custom_cover_path: ruta absoluta a imagen de portada subida por el usuario
-- sort_order: posición manual para drag-reorder (NULL = ordenado por fecha)

ALTER TABLE inventory_items ADD COLUMN display_name    TEXT;
ALTER TABLE inventory_items ADD COLUMN custom_cover_path TEXT;
ALTER TABLE inventory_items ADD COLUMN sort_order      INTEGER;
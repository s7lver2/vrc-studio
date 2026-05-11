-- 012_item_custom_images.sql
-- Array JSON de imágenes custom subidas por el usuario.
-- La primera es la portada (replica custom_cover_path por compatibilidad).
ALTER TABLE inventory_items ADD COLUMN custom_images TEXT DEFAULT '[]';
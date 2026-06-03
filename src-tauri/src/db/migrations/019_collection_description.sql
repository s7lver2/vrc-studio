-- src-tauri/src/db/migrations/019_collection_description.sql
ALTER TABLE shop_collections ADD COLUMN description TEXT NOT NULL DEFAULT '';
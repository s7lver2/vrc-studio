-- Add cover_image_path column to projects table.
-- Used as the project cover art (shown in icon grid view and Discord RPC).
ALTER TABLE projects ADD COLUMN cover_image_path TEXT;

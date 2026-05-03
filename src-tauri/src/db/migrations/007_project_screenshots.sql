-- Add last_screenshot column to projects table.
-- Stores the absolute path to the PNG captured after the last Unity session.
ALTER TABLE projects ADD COLUMN last_screenshot TEXT;
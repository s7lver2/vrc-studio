-- Add sort_order to projects for manual drag-and-drop ordering
ALTER TABLE projects ADD COLUMN sort_order INTEGER;

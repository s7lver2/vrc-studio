-- Stores the specific sub-zip file name to extract for a variant-aware early import.
-- NULL = extract the whole main archive.
ALTER TABLE project_early_imports ADD COLUMN sub_zip_name TEXT;

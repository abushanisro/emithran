-- Add file_step_path column to bom_items to preserve the original STEP/IGES file path.
-- The file_3d_path column stores the browser-viewable STL (converted from STEP);
-- file_step_path stores the original STEP so reanalyze can use full OCC topology.
-- Nullable so existing rows are unaffected.
ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS file_step_path TEXT;

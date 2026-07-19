-- ============================================================================
-- MIGRATION 352: Add hardness and cut_code columns to raw_materials
-- ============================================================================
-- The source Excel contains three columns that are not captured anywhere in
-- the pipeline: Hardness (numeric), Hardness System (Brinell/Rockwell/etc.),
-- and Cut Code (material cutting parameter).  All three are silently dropped
-- on every insert until these columns exist.
-- ============================================================================

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS hardness        DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS hardness_system VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cut_code        DECIMAL(10,2);

COMMENT ON COLUMN raw_materials.hardness        IS 'Material hardness value (unit depends on hardness_system)';
COMMENT ON COLUMN raw_materials.hardness_system IS 'Hardness measurement system: Brinell, Rockwell, Vickers, Shore';
COMMENT ON COLUMN raw_materials.cut_code        IS 'Cutting parameter code from material library';

CREATE INDEX IF NOT EXISTS idx_raw_materials_hardness_system
  ON raw_materials(hardness_system)
  WHERE hardness_system IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

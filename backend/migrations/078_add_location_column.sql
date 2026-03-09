-- ============================================================================
-- MIGRATION 078: Add Location Column to Raw Materials
-- ============================================================================
-- Adds the location column that should have existed from the original schema
-- ============================================================================

-- Add location column to raw_materials table
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS location VARCHAR(100);

-- Add helpful comment
COMMENT ON COLUMN raw_materials.location IS 'Geographic location or origin of the material';

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_location_new ON raw_materials(location);

-- Migration completed successfully
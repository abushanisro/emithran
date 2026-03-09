-- ============================================================================
-- MIGRATION 074: Add Material Type and Description Columns
-- ============================================================================
-- Adds missing columns for material type and description
-- ============================================================================

-- Add missing material columns to raw_materials table
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS material_type VARCHAR(255),
ADD COLUMN IF NOT EXISTS material_description TEXT;

-- Add helpful comments
COMMENT ON COLUMN raw_materials.material_type IS 'Type/category of the material (e.g., Stainless Steel, Carbon Steel)';
COMMENT ON COLUMN raw_materials.material_description IS 'Detailed description of the material';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_type ON raw_materials(material_type);

-- Migration completed successfully
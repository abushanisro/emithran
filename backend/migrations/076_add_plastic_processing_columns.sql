-- ============================================================================
-- MIGRATION 076: Add Plastic Processing Columns to Raw Materials
-- ============================================================================
-- Adds missing columns for plastic processing parameters and applications
-- ============================================================================

-- Add missing plastic-specific columns to raw_materials table
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS application TEXT,
ADD COLUMN IF NOT EXISTS stock_form VARCHAR(100),
ADD COLUMN IF NOT EXISTS matl_state VARCHAR(100);

-- Add helpful comments
COMMENT ON COLUMN raw_materials.application IS 'Material application and use cases';
COMMENT ON COLUMN raw_materials.stock_form IS 'Stock form of material (pellet, granules, etc.)';
COMMENT ON COLUMN raw_materials.matl_state IS 'Material state (amorphous, crystalline, etc.)';

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_application ON raw_materials(application);
CREATE INDEX IF NOT EXISTS idx_raw_materials_stock_form ON raw_materials(stock_form);
CREATE INDEX IF NOT EXISTS idx_raw_materials_matl_state ON raw_materials(matl_state);

-- Migration completed successfully
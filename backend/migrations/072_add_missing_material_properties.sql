-- ============================================================================
-- MIGRATION 072: Add Missing Material Properties Columns
-- ============================================================================
-- Adds missing columns for material properties that are in the Excel but not captured
-- ============================================================================

-- Add missing material properties columns to raw_materials table
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS density DECIMAL(10,4),
ADD COLUMN IF NOT EXISTS ultimate_tensile_strength DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS yield_tensile_strength DECIMAL(10,2), 
ADD COLUMN IF NOT EXISTS shearing_strength DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS astm_standard VARCHAR(100),
ADD COLUMN IF NOT EXISTS din_standard VARCHAR(100),
ADD COLUMN IF NOT EXISTS en_standard VARCHAR(100),
ADD COLUMN IF NOT EXISTS jis_standard VARCHAR(100),
ADD COLUMN IF NOT EXISTS country VARCHAR(100),
ADD COLUMN IF NOT EXISTS shape VARCHAR(100);

-- Add helpful comments
COMMENT ON COLUMN raw_materials.density IS 'Material density in g/cm³';
COMMENT ON COLUMN raw_materials.ultimate_tensile_strength IS 'Ultimate Tensile Strength in MPa';
COMMENT ON COLUMN raw_materials.yield_tensile_strength IS 'Yield Tensile Strength in MPa';
COMMENT ON COLUMN raw_materials.shearing_strength IS 'Shearing Strength in MPa';
COMMENT ON COLUMN raw_materials.astm_standard IS 'ASTM material standard';
COMMENT ON COLUMN raw_materials.din_standard IS 'DIN material standard';
COMMENT ON COLUMN raw_materials.en_standard IS 'EN material standard';
COMMENT ON COLUMN raw_materials.jis_standard IS 'JIS material standard';
COMMENT ON COLUMN raw_materials.country IS 'Country of origin or specification';
COMMENT ON COLUMN raw_materials.shape IS 'Material shape/form';

-- Add constraints for positive values
ALTER TABLE raw_materials 
ADD CONSTRAINT check_positive_density 
CHECK (density IS NULL OR density > 0);

ALTER TABLE raw_materials 
ADD CONSTRAINT check_positive_uts 
CHECK (ultimate_tensile_strength IS NULL OR ultimate_tensile_strength >= 0);

ALTER TABLE raw_materials 
ADD CONSTRAINT check_positive_yts 
CHECK (yield_tensile_strength IS NULL OR yield_tensile_strength >= 0);

ALTER TABLE raw_materials 
ADD CONSTRAINT check_positive_shear 
CHECK (shearing_strength IS NULL OR shearing_strength >= 0);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_density ON raw_materials(density) WHERE density IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_uts ON raw_materials(ultimate_tensile_strength) WHERE ultimate_tensile_strength IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_country ON raw_materials(country);
CREATE INDEX IF NOT EXISTS idx_raw_materials_astm ON raw_materials(astm_standard);

-- Migration completed successfully
-- Quick fix: Add missing material properties columns to raw_materials table
-- Run this SQL directly on your database

-- Add missing columns
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

-- Success message
SELECT 'Missing columns added successfully!' as result;
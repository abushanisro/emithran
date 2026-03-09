-- ============================================================================
-- MIGRATION 070: Fix Material Group Mapping  
-- ============================================================================
-- Updates existing material group values to match system expectations
-- ============================================================================

-- Update existing materials to use system-expected material group values
UPDATE raw_materials 
SET material_group = 'Ferrous & Non-Ferrous'
WHERE material_group ILIKE '%ferrous%' 
   OR material_group ILIKE '%steel%' 
   OR material_group ILIKE '%iron%' 
   OR material_group ILIKE '%metal%'
   OR material_group = 'Ferrous';

UPDATE raw_materials 
SET material_group = 'Plastic & Rubber'
WHERE material_group ILIKE '%plastic%' 
   OR material_group ILIKE '%rubber%' 
   OR material_group ILIKE '%polymer%' 
   OR material_group ILIKE '%elastomer%';

-- Add helpful comment
COMMENT ON COLUMN raw_materials.material_group IS 'Material group classification (Ferrous & Non-Ferrous or Plastic & Rubber)';

-- Migration completed successfully
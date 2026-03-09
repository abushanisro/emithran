-- ============================================================================
-- MIGRATION 071: Fix Missing Year Values
-- ============================================================================
-- Updates existing records to have current year when year is null
-- ============================================================================

-- Update existing materials to have current year when year is null
UPDATE raw_materials 
SET year = 2026
WHERE year IS NULL;

-- Migration completed successfully
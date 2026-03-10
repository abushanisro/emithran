-- ============================================================================
-- Migration: Update Raw Material Cost Records Column Names
-- Purpose: Replace material_grade with material_description and location with country
-- Author: Principal Engineering Team
-- Date: 2026-03-09
-- Version: 1.0.0
-- ============================================================================

-- Rename material_grade column to material_description
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'raw_material_cost_records' 
        AND column_name = 'material_grade'
    ) THEN
        ALTER TABLE raw_material_cost_records RENAME COLUMN material_grade TO material_description;
    END IF;
END $$;

-- Rename location column to country
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'raw_material_cost_records' 
        AND column_name = 'location'
    ) THEN
        ALTER TABLE raw_material_cost_records RENAME COLUMN location TO country;
    END IF;
END $$;

-- Update comments for documentation
COMMENT ON COLUMN raw_material_cost_records.material_description IS 'Material description or specification details';
COMMENT ON COLUMN raw_material_cost_records.country IS 'Country where material cost applies';
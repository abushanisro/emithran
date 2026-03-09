-- Migration: Remove country, year, and material_abbreviation columns from raw_materials table
-- Date: 2026-03-09

-- Remove the country column
ALTER TABLE raw_materials DROP COLUMN IF EXISTS country;

-- Remove the year column
ALTER TABLE raw_materials DROP COLUMN IF EXISTS year;

-- Remove the material_abbreviation column
ALTER TABLE raw_materials DROP COLUMN IF EXISTS material_abbreviation;
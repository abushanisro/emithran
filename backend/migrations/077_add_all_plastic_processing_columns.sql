-- ============================================================================
-- MIGRATION 077: Add All Missing Plastic Processing Columns
-- ============================================================================
-- Adds all missing columns for plastic processing parameters that exist in the original schema
-- but are missing from current database table
-- ============================================================================

-- Add all missing plastic processing columns to raw_materials table
-- These columns were defined in the original schema but not created
ALTER TABLE raw_materials 
ADD COLUMN IF NOT EXISTS clamping_pressure_mpa DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS eject_deflection_temp_c DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS melting_temp_c DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS mold_temp_c DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS specific_heat_melt DECIMAL(10,4),
ADD COLUMN IF NOT EXISTS thermal_conductivity_melt DECIMAL(10,4),
ADD COLUMN IF NOT EXISTS regrinding VARCHAR(10),
ADD COLUMN IF NOT EXISTS regrinding_percentage DECIMAL(5,2);

-- Add helpful comments
COMMENT ON COLUMN raw_materials.clamping_pressure_mpa IS 'Clamping pressure for injection molding in MPa';
COMMENT ON COLUMN raw_materials.eject_deflection_temp_c IS 'Ejection deflection temperature in Celsius';
COMMENT ON COLUMN raw_materials.melting_temp_c IS 'Material melting temperature in Celsius';
COMMENT ON COLUMN raw_materials.mold_temp_c IS 'Recommended mold temperature in Celsius';
COMMENT ON COLUMN raw_materials.specific_heat_melt IS 'Specific heat of melt in J/g·°C';
COMMENT ON COLUMN raw_materials.thermal_conductivity_melt IS 'Thermal conductivity of melt in W/m·°C';
COMMENT ON COLUMN raw_materials.regrinding IS 'Whether material supports regrinding (Yes/No)';
COMMENT ON COLUMN raw_materials.regrinding_percentage IS 'Percentage of regrind allowed (0-100%)';

-- Add constraints for positive values and valid ranges
-- Note: Using DO blocks to safely add constraints only if they don't exist

DO $$
BEGIN
    -- Add clamping pressure constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_clamping_pressure') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_positive_clamping_pressure 
        CHECK (clamping_pressure_mpa IS NULL OR clamping_pressure_mpa >= 0);
    END IF;

    -- Add eject temperature constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_eject_temp') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_positive_eject_temp 
        CHECK (eject_deflection_temp_c IS NULL OR eject_deflection_temp_c >= 0);
    END IF;

    -- Add melting temperature constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_melting_temp') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_positive_melting_temp 
        CHECK (melting_temp_c IS NULL OR melting_temp_c >= 0);
    END IF;

    -- Add mold temperature constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_mold_temp') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_positive_mold_temp 
        CHECK (mold_temp_c IS NULL OR mold_temp_c >= 0);
    END IF;

    -- Add specific heat constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_specific_heat') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_positive_specific_heat 
        CHECK (specific_heat_melt IS NULL OR specific_heat_melt >= 0);
    END IF;

    -- Add thermal conductivity constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_thermal_conductivity') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_positive_thermal_conductivity 
        CHECK (thermal_conductivity_melt IS NULL OR thermal_conductivity_melt >= 0);
    END IF;

    -- Add regrinding values constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_regrinding_values') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_regrinding_values 
        CHECK (regrinding IS NULL OR regrinding IN ('Yes', 'No', 'yes', 'no', 'YES', 'NO'));
    END IF;

    -- Add regrinding percentage constraint
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_regrinding_percentage_range') THEN
        ALTER TABLE raw_materials ADD CONSTRAINT check_regrinding_percentage_range 
        CHECK (regrinding_percentage IS NULL OR (regrinding_percentage >= 0 AND regrinding_percentage <= 100));
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_materials_clamping_pressure ON raw_materials(clamping_pressure_mpa) WHERE clamping_pressure_mpa IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_melting_temp ON raw_materials(melting_temp_c) WHERE melting_temp_c IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_materials_regrinding ON raw_materials(regrinding);

-- Migration completed successfully
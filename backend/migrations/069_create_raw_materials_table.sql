-- ============================================================================
-- MIGRATION 069: Create Raw Materials Table
-- ============================================================================
-- Creates the raw_materials table with single cost column
-- ============================================================================

-- Drop existing table if it exists (for clean migration)
DROP TABLE IF EXISTS raw_materials CASCADE;

-- Create raw_materials table
CREATE TABLE IF NOT EXISTS raw_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Material Classification
    material_group VARCHAR(255) NOT NULL,
    material VARCHAR(255) NOT NULL,
    material_abbreviation VARCHAR(100),
    material_grade VARCHAR(255),
    stock_form VARCHAR(100),
    matl_state VARCHAR(100),
    
    -- Application and Properties
    application TEXT,
    regrinding BOOLEAN DEFAULT false,
    regrinding_percentage DECIMAL(5,2),
    
    -- Process Parameters
    clamping_pressure_mpa DECIMAL(10,2),
    eject_deflection_temp_c DECIMAL(10,2),
    melting_temp_c DECIMAL(10,2),
    mold_temp_c DECIMAL(10,2),
    
    -- Material Properties
    density_kg_m3 DECIMAL(10,2),
    specific_heat_melt DECIMAL(10,4),
    thermal_conductivity_melt DECIMAL(10,4),
    
    -- Location and Year
    location VARCHAR(100),
    year INTEGER,
    
    -- Single Cost Data (INR)
    cost DECIMAL(15,4) DEFAULT 0,
    
    -- Ownership and timestamps
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_raw_materials_user_id ON raw_materials(user_id);
CREATE INDEX IF NOT EXISTS idx_raw_materials_material_group ON raw_materials(material_group);
CREATE INDEX IF NOT EXISTS idx_raw_materials_material ON raw_materials(material);
CREATE INDEX IF NOT EXISTS idx_raw_materials_abbreviation ON raw_materials(material_abbreviation);
CREATE INDEX IF NOT EXISTS idx_raw_materials_grade ON raw_materials(material_grade);
CREATE INDEX IF NOT EXISTS idx_raw_materials_location ON raw_materials(location);
CREATE INDEX IF NOT EXISTS idx_raw_materials_year ON raw_materials(year);
CREATE INDEX IF NOT EXISTS idx_raw_materials_cost ON raw_materials(cost) WHERE cost > 0;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on raw_materials table
ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

-- Users can manage their own raw materials
CREATE POLICY "Users can manage their raw_materials"
    ON raw_materials FOR ALL
    USING (auth.uid() = user_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update timestamp on changes
CREATE TRIGGER update_raw_materials_updated_at 
    BEFORE UPDATE ON raw_materials
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- DATA VALIDATION
-- ============================================================================

-- Add constraints for data integrity
ALTER TABLE raw_materials 
ADD CONSTRAINT check_positive_cost 
CHECK (cost IS NULL OR cost >= 0);

ALTER TABLE raw_materials 
ADD CONSTRAINT check_valid_year 
CHECK (year IS NULL OR (year >= 2000 AND year <= 2100));

ALTER TABLE raw_materials 
ADD CONSTRAINT check_regrinding_percentage 
CHECK (regrinding_percentage IS NULL OR (regrinding_percentage >= 0 AND regrinding_percentage <= 100));

-- ============================================================================
-- HELPFUL COMMENTS
-- ============================================================================

COMMENT ON TABLE raw_materials IS 'Raw materials table for tracking material specifications and cost';
COMMENT ON COLUMN raw_materials.cost IS 'Material cost per unit in INR';
COMMENT ON COLUMN raw_materials.matl_state IS 'Material state (solid, liquid, etc.)';

-- Migration completed successfully
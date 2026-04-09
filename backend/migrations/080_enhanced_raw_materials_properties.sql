-- Enhanced Raw Materials Database with Comprehensive Properties
-- Principal Engineer Migration for Material Properties System

-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS material_properties CASCADE;
DROP TABLE IF EXISTS material_categories CASCADE;
DROP TABLE IF EXISTS thermal_properties CASCADE;
DROP TABLE IF EXISTS mechanical_properties CASCADE;
DROP TABLE IF EXISTS processing_properties CASCADE;

-- Create material categories table
CREATE TABLE material_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_name VARCHAR(100) NOT NULL UNIQUE,
    category_code VARCHAR(20) NOT NULL UNIQUE,
    parent_category VARCHAR(100),
    description TEXT,
    color_code VARCHAR(7) DEFAULT '#666666',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert material categories
INSERT INTO material_categories (category_name, category_code, parent_category, description, color_code) VALUES
-- Main Categories
('Plastics', 'PLASTIC', NULL, 'Polymeric materials including thermoplastics and thermosets', '#4CAF50'),
('Ferrous Metals', 'FERROUS', NULL, 'Iron-based metals and alloys', '#FF5722'),
('Non-Ferrous Metals', 'NON_FERROUS', NULL, 'Non-iron metals and alloys', '#2196F3'),
('Composites', 'COMPOSITE', NULL, 'Reinforced and composite materials', '#9C27B0'),
('Ceramics', 'CERAMIC', NULL, 'Ceramic and glass materials', '#FF9800'),
('Elastomers', 'ELASTOMER', NULL, 'Rubber and elastic materials', '#795548'),

-- Plastic Sub-categories
('Thermoplastics', 'THERMO', 'Plastics', 'Heat-formable plastic materials', '#66BB6A'),
('Thermosets', 'THERMO_SET', 'Plastics', 'Cross-linked polymer materials', '#4CAF50'),
('Engineering Plastics', 'ENG_PLASTIC', 'Plastics', 'High-performance engineering plastics', '#388E3C'),

-- Ferrous Sub-categories
('Carbon Steel', 'CARBON_STEEL', 'Ferrous Metals', 'Plain carbon steels', '#D32F2F'),
('Alloy Steel', 'ALLOY_STEEL', 'Ferrous Metals', 'Alloyed steel grades', '#F44336'),
('Stainless Steel', 'SS', 'Ferrous Metals', 'Corrosion-resistant steels', '#FF5722'),
('Cast Iron', 'CAST_IRON', 'Ferrous Metals', 'Cast iron varieties', '#BF360C'),
('Tool Steel', 'TOOL_STEEL', 'Ferrous Metals', 'Tool and die steels', '#E64A19'),

-- Non-Ferrous Sub-categories
('Aluminum Alloys', 'AL_ALLOY', 'Non-Ferrous Metals', 'Aluminum-based alloys', '#1976D2'),
('Copper Alloys', 'CU_ALLOY', 'Non-Ferrous Metals', 'Copper-based alloys', '#F57C00'),
('Titanium Alloys', 'TI_ALLOY', 'Non-Ferrous Metals', 'Titanium-based alloys', '#607D8B'),
('Nickel Alloys', 'NI_ALLOY', 'Non-Ferrous Metals', 'Nickel-based superalloys', '#9E9E9E'),
('Zinc Alloys', 'ZN_ALLOY', 'Non-Ferrous Metals', 'Zinc die-casting alloys', '#2196F3');

-- Create thermal properties table
CREATE TABLE thermal_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL,
    melting_temp_celsius DECIMAL(8,2),
    glass_transition_temp_celsius DECIMAL(8,2),
    deflection_temp_celsius DECIMAL(8,2),
    thermal_conductivity_w_m_k DECIMAL(10,4),
    specific_heat_j_g_k DECIMAL(8,4),
    thermal_expansion_coeff DECIMAL(12,8),
    heat_distortion_temp_celsius DECIMAL(8,2),
    max_service_temp_celsius DECIMAL(8,2),
    min_service_temp_celsius DECIMAL(8,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create mechanical properties table
CREATE TABLE mechanical_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL,
    density_kg_m3 DECIMAL(8,2),
    tensile_strength_mpa DECIMAL(10,2),
    yield_strength_mpa DECIMAL(10,2),
    compressive_strength_mpa DECIMAL(10,2),
    flexural_strength_mpa DECIMAL(10,2),
    elastic_modulus_gpa DECIMAL(8,2),
    shear_modulus_gpa DECIMAL(8,2),
    poisson_ratio DECIMAL(6,4),
    elongation_at_break_percent DECIMAL(6,2),
    hardness_value DECIMAL(8,2),
    hardness_scale VARCHAR(20),
    impact_strength_j_m DECIMAL(8,2),
    fatigue_limit_mpa DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create processing properties table (for manufacturing)
CREATE TABLE processing_properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL,
    -- Injection Molding Properties
    mold_temp_celsius_min DECIMAL(6,2),
    mold_temp_celsius_max DECIMAL(6,2),
    melt_temp_celsius_min DECIMAL(6,2),
    melt_temp_celsius_max DECIMAL(6,2),
    injection_pressure_mpa_min DECIMAL(8,2),
    injection_pressure_mpa_max DECIMAL(8,2),
    clamping_pressure_mpa DECIMAL(8,2),
    cooling_time_factor DECIMAL(6,4),
    shrinkage_rate_percent DECIMAL(6,4),
    -- Machining Properties
    cutting_speed_m_min DECIMAL(8,2),
    feed_rate_mm_rev DECIMAL(8,4),
    machinability_index DECIMAL(6,2),
    -- General Processing
    drying_temp_celsius DECIMAL(6,2),
    drying_time_hours DECIMAL(6,2),
    moisture_content_percent DECIMAL(6,4),
    regrind_percentage_max DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enhanced raw materials table
CREATE TABLE enhanced_raw_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Basic Information
    material_name VARCHAR(255) NOT NULL,
    material_grade VARCHAR(100),
    material_specification VARCHAR(100),
    manufacturer VARCHAR(100),
    supplier VARCHAR(100),
    
    -- Category Classification
    category_id UUID REFERENCES material_categories(id),
    material_family VARCHAR(100),
    
    -- Business Properties
    cost_per_kg DECIMAL(12,4),
    cost_per_unit DECIMAL(12,4),
    unit_type VARCHAR(50) DEFAULT 'kg',
    currency VARCHAR(10) DEFAULT 'INR',
    lead_time_days INTEGER,
    minimum_order_quantity DECIMAL(10,2),
    
    -- Storage & Logistics
    storage_location VARCHAR(100),
    shelf_life_months INTEGER,
    special_storage_requirements TEXT,
    hazmat_classification VARCHAR(50),
    
    -- Quality & Standards
    quality_grade VARCHAR(50),
    certification_standards TEXT[],
    test_certificates JSONB,
    
    -- Sustainability
    recycled_content_percent DECIMAL(5,2),
    recyclability_rating VARCHAR(20),
    environmental_impact_score DECIMAL(4,2),
    
    -- Usage Tracking
    monthly_consumption_kg DECIMAL(10,2),
    reorder_point_kg DECIMAL(10,2),
    safety_stock_kg DECIMAL(10,2),
    
    -- Metadata
    notes TEXT,
    internal_code VARCHAR(50),
    external_code VARCHAR(50),
    status VARCHAR(20) DEFAULT 'active',
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key constraints
ALTER TABLE thermal_properties ADD CONSTRAINT fk_thermal_material 
    FOREIGN KEY (material_id) REFERENCES enhanced_raw_materials(id) ON DELETE CASCADE;

ALTER TABLE mechanical_properties ADD CONSTRAINT fk_mechanical_material 
    FOREIGN KEY (material_id) REFERENCES enhanced_raw_materials(id) ON DELETE CASCADE;

ALTER TABLE processing_properties ADD CONSTRAINT fk_processing_material 
    FOREIGN KEY (material_id) REFERENCES enhanced_raw_materials(id) ON DELETE CASCADE;

-- Create indexes for better performance
CREATE INDEX idx_materials_category ON enhanced_raw_materials(category_id);
CREATE INDEX idx_materials_name ON enhanced_raw_materials(material_name);
CREATE INDEX idx_materials_grade ON enhanced_raw_materials(material_grade);
CREATE INDEX idx_materials_status ON enhanced_raw_materials(status);
CREATE INDEX idx_thermal_material ON thermal_properties(material_id);
CREATE INDEX idx_mechanical_material ON mechanical_properties(material_id);
CREATE INDEX idx_processing_material ON processing_properties(material_id);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_material_categories_updated_at BEFORE UPDATE ON material_categories 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_enhanced_raw_materials_updated_at BEFORE UPDATE ON enhanced_raw_materials 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_thermal_properties_updated_at BEFORE UPDATE ON thermal_properties 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mechanical_properties_updated_at BEFORE UPDATE ON mechanical_properties 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_processing_properties_updated_at BEFORE UPDATE ON processing_properties 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create comprehensive view for material lookup
CREATE VIEW material_lookup_view AS
SELECT 
    m.id,
    m.material_name,
    m.material_grade,
    m.material_specification,
    m.manufacturer,
    m.supplier,
    mc.category_name,
    mc.category_code,
    mc.color_code,
    
    -- Costs
    m.cost_per_kg,
    m.cost_per_unit,
    m.unit_type,
    
    -- Basic Properties
    mech.density_kg_m3,
    mech.tensile_strength_mpa as uts_mpa,
    mech.yield_strength_mpa as yts_mpa,
    mech.elastic_modulus_gpa,
    mech.hardness_value,
    mech.hardness_scale,
    
    -- Thermal Properties
    therm.melting_temp_celsius,
    therm.deflection_temp_celsius as eject_deflection_temp_celsius,
    therm.thermal_conductivity_w_m_k,
    therm.specific_heat_j_g_k,
    therm.max_service_temp_celsius,
    
    -- Processing Properties
    proc.mold_temp_celsius_min,
    proc.mold_temp_celsius_max,
    proc.melt_temp_celsius_min,
    proc.melt_temp_celsius_max,
    proc.clamping_pressure_mpa,
    proc.injection_pressure_mpa_min,
    proc.injection_pressure_mpa_max,
    proc.shrinkage_rate_percent,
    
    -- Storage & Business
    m.storage_location,
    m.lead_time_days,
    m.minimum_order_quantity,
    m.quality_grade,
    m.status,
    m.created_at,
    m.updated_at

FROM enhanced_raw_materials m
LEFT JOIN material_categories mc ON m.category_id = mc.id
LEFT JOIN mechanical_properties mech ON m.id = mech.material_id
LEFT JOIN thermal_properties therm ON m.id = therm.material_id
LEFT JOIN processing_properties proc ON m.id = proc.material_id
WHERE m.status = 'active';

-- Insert sample data for the example material
INSERT INTO enhanced_raw_materials (
    material_name, material_grade, material_specification, manufacturer, category_id, 
    cost_per_kg, storage_location, quality_grade, internal_code
) 
SELECT 
    '100Cr6', '1.3505', 'High Carbon Bearing Steel', 'Various', mc.id, 
    125.50, 'Warehouse A-1', 'Premium', 'STL-100CR6-001'
FROM material_categories mc WHERE mc.category_code = 'ALLOY_STEEL';

-- Get the material ID for properties insertion
WITH material_insert AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'STL-100CR6-001'
)
INSERT INTO mechanical_properties (
    material_id, density_kg_m3, tensile_strength_mpa, yield_strength_mpa, 
    elastic_modulus_gpa, hardness_value, hardness_scale
)
SELECT 
    id, 7850.0, 2200.0, 1800.0, 210.0, 62.0, 'HRC'
FROM material_insert;

WITH material_insert AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'STL-100CR6-001'
)
INSERT INTO thermal_properties (
    material_id, melting_temp_celsius, thermal_conductivity_w_m_k, specific_heat_j_g_k, max_service_temp_celsius
)
SELECT 
    id, 1500.0, 46.0, 0.46, 200.0
FROM material_insert;

WITH material_insert AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'STL-100CR6-001'
)
INSERT INTO processing_properties (
    material_id, cutting_speed_m_min, feed_rate_mm_rev, machinability_index
)
SELECT 
    id, 120.0, 0.15, 60.0
FROM material_insert;

-- Comments for documentation
COMMENT ON TABLE enhanced_raw_materials IS 'Principal Engineer designed raw materials database with comprehensive properties';
COMMENT ON TABLE material_categories IS 'Hierarchical categorization of materials (plastics, ferrous, non-ferrous, etc.)';
COMMENT ON TABLE thermal_properties IS 'Thermal characteristics for material processing and application';
COMMENT ON TABLE mechanical_properties IS 'Mechanical properties including strength, modulus, hardness';
COMMENT ON TABLE processing_properties IS 'Manufacturing and processing parameters';
COMMENT ON VIEW material_lookup_view IS 'Comprehensive view for calculator lookup functionality';
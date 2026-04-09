-- Sample Materials Data - Principal Engineer Curated Dataset
-- This populates the enhanced materials database with realistic sample data

-- Insert sample ABS plastic material
WITH plastic_category AS (
    SELECT id FROM material_categories WHERE category_code = 'THERMO'
),
abs_material AS (
    INSERT INTO enhanced_raw_materials (
        material_name, material_grade, material_specification, manufacturer, supplier,
        category_id, cost_per_kg, cost_per_unit, unit_type, storage_location,
        lead_time_days, minimum_order_quantity, quality_grade, notes,
        internal_code, external_code
    )
    SELECT 
        'ABS', 'GP-22', 'General Purpose ABS', 'SABIC', 'Local Supplier',
        pc.id, 299.00, 299.00, 'kg', 'Warehouse B-2',
        14, 25.0, 'Commercial', 'General purpose ABS for injection molding',
        'PLA-ABS-001', 'SABIC-GP22'
    FROM plastic_category pc
    RETURNING id
)
INSERT INTO mechanical_properties (
    material_id, density_kg_m3, tensile_strength_mpa, yield_strength_mpa,
    flexural_strength_mpa, elastic_modulus_gpa, elongation_at_break_percent,
    hardness_value, hardness_scale, impact_strength_j_m
)
SELECT 
    id, 1040.0, 45.0, 38.0, 68.0, 2.3, 25.0, 85.0, 'Shore D', 250.0
FROM abs_material;

WITH plastic_category AS (
    SELECT id FROM material_categories WHERE category_code = 'THERMO'
),
abs_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'PLA-ABS-001'
)
INSERT INTO thermal_properties (
    material_id, glass_transition_temp_celsius, deflection_temp_celsius,
    thermal_conductivity_w_m_k, specific_heat_j_g_k, thermal_expansion_coeff,
    heat_distortion_temp_celsius, max_service_temp_celsius, min_service_temp_celsius
)
SELECT 
    am.id, 105.0, 85.0, 0.127, 1.80, 70.0, 85.0, 80.0, -40.0
FROM abs_material am;

WITH abs_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'PLA-ABS-001'
)
INSERT INTO processing_properties (
    material_id, mold_temp_celsius_min, mold_temp_celsius_max,
    melt_temp_celsius_min, melt_temp_celsius_max, injection_pressure_mpa_min,
    injection_pressure_mpa_max, clamping_pressure_mpa, cooling_time_factor,
    shrinkage_rate_percent, drying_temp_celsius, drying_time_hours,
    moisture_content_percent, regrind_percentage_max
)
SELECT 
    id, 50.0, 80.0, 220.0, 260.0, 80.0, 120.0, 49.4, 1.2,
    0.001, 80.0, 4.0, 0.05, 20.0
FROM abs_material;

-- Insert aluminum alloy material
WITH aluminum_category AS (
    SELECT id FROM material_categories WHERE category_code = 'AL_ALLOY'
),
aluminum_material AS (
    INSERT INTO enhanced_raw_materials (
        material_name, material_grade, material_specification, manufacturer, supplier,
        category_id, cost_per_kg, cost_per_unit, unit_type, storage_location,
        lead_time_days, minimum_order_quantity, quality_grade, notes,
        internal_code, external_code
    )
    SELECT 
        'Aluminum 6061', 'T6', 'Al-Mg-Si Alloy', 'Hindalco', 'Metal Suppliers Inc',
        ac.id, 185.50, 185.50, 'kg', 'Warehouse C-1',
        21, 50.0, 'Aerospace', 'Heat treatable aluminum alloy',
        'AL-6061-T6-001', 'HIND-6061T6'
    FROM aluminum_category ac
    RETURNING id
)
INSERT INTO mechanical_properties (
    material_id, density_kg_m3, tensile_strength_mpa, yield_strength_mpa,
    compressive_strength_mpa, elastic_modulus_gpa, shear_modulus_gpa,
    poisson_ratio, elongation_at_break_percent, hardness_value, hardness_scale
)
SELECT 
    id, 2700.0, 310.0, 276.0, 280.0, 68.9, 26.0, 0.33, 12.0, 95.0, 'HB'
FROM aluminum_material;

WITH aluminum_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'AL-6061-T6-001'
)
INSERT INTO thermal_properties (
    material_id, melting_temp_celsius, thermal_conductivity_w_m_k, 
    specific_heat_j_g_k, thermal_expansion_coeff, max_service_temp_celsius, 
    min_service_temp_celsius
)
SELECT 
    id, 660.0, 167.0, 0.896, 23.6, 200.0, -200.0
FROM aluminum_material;

WITH aluminum_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'AL-6061-T6-001'
)
INSERT INTO processing_properties (
    material_id, cutting_speed_m_min, feed_rate_mm_rev, machinability_index
)
SELECT 
    id, 300.0, 0.25, 90.0
FROM aluminum_material;

-- Insert stainless steel material
WITH ss_category AS (
    SELECT id FROM material_categories WHERE category_code = 'SS'
),
ss_material AS (
    INSERT INTO enhanced_raw_materials (
        material_name, material_grade, material_specification, manufacturer, supplier,
        category_id, cost_per_kg, cost_per_unit, unit_type, storage_location,
        lead_time_days, minimum_order_quantity, quality_grade, notes,
        internal_code, external_code
    )
    SELECT 
        'Stainless Steel 316L', '1.4404', 'Austenitic Stainless Steel', 'Jindal Steel', 'Steel Trading Co',
        sc.id, 325.75, 325.75, 'kg', 'Warehouse A-3',
        28, 100.0, 'Medical Grade', 'Low carbon austenitic stainless steel',
        'SS-316L-001', 'JINDAL-316L'
    FROM ss_category sc
    RETURNING id
)
INSERT INTO mechanical_properties (
    material_id, density_kg_m3, tensile_strength_mpa, yield_strength_mpa,
    elastic_modulus_gpa, elongation_at_break_percent, hardness_value, hardness_scale
)
SELECT 
    id, 8000.0, 580.0, 290.0, 200.0, 50.0, 217.0, 'HB'
FROM ss_material;

WITH ss_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'SS-316L-001'
)
INSERT INTO thermal_properties (
    material_id, melting_temp_celsius, thermal_conductivity_w_m_k, 
    specific_heat_j_g_k, thermal_expansion_coeff, max_service_temp_celsius
)
SELECT 
    id, 1400.0, 16.3, 0.50, 16.0, 800.0
FROM ss_material;

WITH ss_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'SS-316L-001'
)
INSERT INTO processing_properties (
    material_id, cutting_speed_m_min, feed_rate_mm_rev, machinability_index
)
SELECT 
    id, 80.0, 0.15, 45.0
FROM ss_material;

-- Insert copper alloy material
WITH copper_category AS (
    SELECT id FROM material_categories WHERE category_code = 'CU_ALLOY'
),
copper_material AS (
    INSERT INTO enhanced_raw_materials (
        material_name, material_grade, material_specification, manufacturer, supplier,
        category_id, cost_per_kg, cost_per_unit, unit_type, storage_location,
        lead_time_days, minimum_order_quantity, quality_grade, notes,
        internal_code, external_code
    )
    SELECT 
        'Copper C101', 'OFC', 'Oxygen-Free Copper', 'Hindustan Copper', 'Copper Works Ltd',
        cc.id, 445.25, 445.25, 'kg', 'Warehouse D-1',
        35, 25.0, 'Electronic Grade', 'High purity oxygen-free copper',
        'CU-C101-001', 'HIND-C101-OFC'
    FROM copper_category cc
    RETURNING id
)
INSERT INTO mechanical_properties (
    material_id, density_kg_m3, tensile_strength_mpa, yield_strength_mpa,
    elastic_modulus_gpa, elongation_at_break_percent, hardness_value, hardness_scale
)
SELECT 
    id, 8940.0, 220.0, 70.0, 117.0, 45.0, 45.0, 'HB'
FROM copper_material;

WITH copper_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'CU-C101-001'
)
INSERT INTO thermal_properties (
    material_id, melting_temp_celsius, thermal_conductivity_w_m_k, 
    specific_heat_j_g_k, thermal_expansion_coeff, max_service_temp_celsius
)
SELECT 
    id, 1085.0, 390.0, 0.385, 16.5, 250.0
FROM copper_material;

-- Insert polypropylene material
WITH plastic_category AS (
    SELECT id FROM material_categories WHERE category_code = 'THERMO'
),
pp_material AS (
    INSERT INTO enhanced_raw_materials (
        material_name, material_grade, material_specification, manufacturer, supplier,
        category_id, cost_per_kg, cost_per_unit, unit_type, storage_location,
        lead_time_days, minimum_order_quantity, quality_grade, notes,
        internal_code, external_code
    )
    SELECT 
        'Polypropylene', 'H301', 'Homopolymer PP', 'Reliance Industries', 'Polymer Distributors',
        pc.id, 145.80, 145.80, 'kg', 'Warehouse B-1',
        10, 25.0, 'Food Grade', 'General purpose polypropylene homopolymer',
        'PP-H301-001', 'RIL-PP-H301'
    FROM plastic_category pc
    RETURNING id
)
INSERT INTO mechanical_properties (
    material_id, density_kg_m3, tensile_strength_mpa, yield_strength_mpa,
    flexural_strength_mpa, elastic_modulus_gpa, elongation_at_break_percent,
    hardness_value, hardness_scale, impact_strength_j_m
)
SELECT 
    id, 905.0, 32.0, 28.0, 45.0, 1.5, 400.0, 75.0, 'Shore D', 40.0
FROM pp_material;

WITH pp_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'PP-H301-001'
)
INSERT INTO thermal_properties (
    material_id, melting_temp_celsius, deflection_temp_celsius,
    thermal_conductivity_w_m_k, specific_heat_j_g_k, thermal_expansion_coeff,
    heat_distortion_temp_celsius, max_service_temp_celsius, min_service_temp_celsius
)
SELECT 
    id, 165.0, 55.0, 0.22, 1.92, 110.0, 55.0, 100.0, -20.0
FROM pp_material;

WITH pp_material AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'PP-H301-001'
)
INSERT INTO processing_properties (
    material_id, mold_temp_celsius_min, mold_temp_celsius_max,
    melt_temp_celsius_min, melt_temp_celsius_max, injection_pressure_mpa_min,
    injection_pressure_mpa_max, clamping_pressure_mpa, cooling_time_factor,
    shrinkage_rate_percent, drying_temp_celsius, drying_time_hours,
    moisture_content_percent, regrind_percentage_max
)
SELECT 
    id, 30.0, 60.0, 180.0, 220.0, 60.0, 100.0, 35.0, 1.0,
    0.015, 60.0, 2.0, 0.02, 25.0
FROM pp_material;

-- Update the existing 100Cr6 material with complete properties
UPDATE enhanced_raw_materials 
SET 
    manufacturer = 'Various Steel Mills',
    supplier = 'Bearing Steel Suppliers',
    cost_per_kg = 209.60,
    storage_location = 'Warehouse A-1',
    lead_time_days = 45,
    minimum_order_quantity = 100.0,
    quality_grade = 'Bearing Grade',
    notes = 'High carbon chromium bearing steel for precision applications'
WHERE internal_code = 'STL-100CR6-001';

-- Update mechanical properties for 100Cr6
WITH bearing_steel AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'STL-100CR6-001'
)
UPDATE mechanical_properties 
SET 
    tensile_strength_mpa = 1470.0,
    yield_strength_mpa = 1130.0,
    compressive_strength_mpa = 2200.0,
    elastic_modulus_gpa = 210.0,
    elongation_at_break_percent = 9.0,
    hardness_value = 62.0,
    hardness_scale = 'HRC',
    impact_strength_j_m = 15.0
WHERE material_id IN (SELECT id FROM bearing_steel);

-- Update thermal properties for 100Cr6
WITH bearing_steel AS (
    SELECT id FROM enhanced_raw_materials WHERE internal_code = 'STL-100CR6-001'
)
UPDATE thermal_properties 
SET 
    melting_temp_celsius = 1500.0,
    deflection_temp_celsius = 200.0,
    thermal_conductivity_w_m_k = 46.0,
    specific_heat_j_g_k = 0.46,
    thermal_expansion_coeff = 11.5,
    max_service_temp_celsius = 200.0,
    min_service_temp_celsius = -40.0
WHERE material_id IN (SELECT id FROM bearing_steel);

-- Comments
COMMENT ON TABLE enhanced_raw_materials IS 'Enhanced raw materials with comprehensive properties for engineering calculations';

-- Create summary views for different material categories
CREATE OR REPLACE VIEW plastic_materials_summary AS
SELECT 
    m.*,
    mech.density_kg_m3,
    therm.melting_temp_celsius,
    proc.clamping_pressure_mpa,
    proc.mold_temp_celsius_min
FROM enhanced_raw_materials m
JOIN material_categories mc ON m.category_id = mc.id
LEFT JOIN mechanical_properties mech ON m.id = mech.material_id
LEFT JOIN thermal_properties therm ON m.id = therm.material_id
LEFT JOIN processing_properties proc ON m.id = proc.material_id
WHERE mc.category_name LIKE '%Plastic%' OR mc.parent_category = 'Plastics';

CREATE OR REPLACE VIEW metal_materials_summary AS
SELECT 
    m.*,
    mech.density_kg_m3,
    mech.tensile_strength_mpa as uts_mpa,
    mech.yield_strength_mpa as yts_mpa,
    mech.hardness_value,
    mech.hardness_scale,
    therm.melting_temp_celsius
FROM enhanced_raw_materials m
JOIN material_categories mc ON m.category_id = mc.id
LEFT JOIN mechanical_properties mech ON m.id = mech.material_id
LEFT JOIN thermal_properties therm ON m.id = therm.material_id
WHERE mc.category_name LIKE '%Metal%' OR mc.category_name LIKE '%Ferrous%' OR mc.category_name LIKE '%Steel%' OR mc.category_name LIKE '%Aluminum%' OR mc.category_name LIKE '%Copper%';

-- Index for better performance
CREATE INDEX IF NOT EXISTS idx_materials_internal_code ON enhanced_raw_materials(internal_code);
CREATE INDEX IF NOT EXISTS idx_materials_search ON enhanced_raw_materials USING gin(to_tsvector('english', material_name || ' ' || COALESCE(material_grade, '') || ' ' || COALESCE(material_specification, '')));

-- Final data validation
SELECT 
    'Materials count' as metric,
    COUNT(*) as value
FROM enhanced_raw_materials
UNION ALL
SELECT 
    'Plastic materials' as metric,
    COUNT(*) as value
FROM plastic_materials_summary
UNION ALL
SELECT 
    'Metal materials' as metric,
    COUNT(*) as value
FROM metal_materials_summary;
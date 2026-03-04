-- ============================================================================
-- ENTERPRISE CALCULATOR SYSTEM FIX - CORRECTED VERSION
-- ============================================================================
-- Problem: Calculators have input fields but no calculated fields or formulas
-- Solution: Add proper calculated fields and formula system for scalability

-- Step 1: Check current calculator system structure
SELECT 
    'Current Calculator System Status' as check_type,
    COUNT(DISTINCT c.id) as total_calculators,
    COUNT(DISTINCT cf.id) as total_fields,
    COUNT(DISTINCT cfm.id) as total_formulas,
    COUNT(CASE WHEN cf.field_type = 'calculated' THEN 1 END) as calculated_fields
FROM calculators c
LEFT JOIN calculator_fields cf ON c.id = cf.calculator_id
LEFT JOIN calculator_formulas cfm ON c.id = cfm.calculator_id;

-- Step 2: Add calculated output fields for your specific calculator
INSERT INTO calculator_fields (
    calculator_id,
    field_name,
    display_label,
    field_type,
    unit,
    display_order,
    is_required,
    default_value
) VALUES 
('dce81348-b964-4294-99d3-dc15405cd9af'::uuid, 'volume', 'Calculated Volume', 'calculated', 'mm³', 100, false, ''),
('dce81348-b964-4294-99d3-dc15405cd9af'::uuid, 'density', 'Material Density', 'calculated', 'g/cm³', 101, false, ''),
('dce81348-b964-4294-99d3-dc15405cd9af'::uuid, 'surfaceVolumeRatio', 'Surface/Volume Ratio', 'calculated', 'mm⁻¹', 102, false, '')
ON CONFLICT (calculator_id, field_name) DO UPDATE SET
    display_label = EXCLUDED.display_label,
    field_type = EXCLUDED.field_type,
    unit = EXCLUDED.unit;

-- Step 3: Add calculation formulas (using correct column names)
INSERT INTO calculator_formulas (
    calculator_id,
    formula_name,
    display_label,
    description,
    formula_expression,
    output_unit,
    decimal_places,
    display_in_results
) VALUES 
(
    'dce81348-b964-4294-99d3-dc15405cd9af'::uuid,
    'calculateVolume',
    'Volume Calculation',
    'Calculates part volume from dimensions',
    'Max_Length * Max_Width * Max_Height',
    'mm³',
    2,
    true
),
(
    'dce81348-b964-4294-99d3-dc15405cd9af'::uuid,
    'calculateDensity',
    'Density Calculation', 
    'Calculates material density from weight and volume',
    'Weight / (Max_Length * Max_Width * Max_Height / 1000000)',
    'g/cm³',
    3,
    true
),
(
    'dce81348-b964-4294-99d3-dc15405cd9af'::uuid,
    'calculateSurfaceVolumeRatio',
    'Surface to Volume Ratio',
    'Ratio of surface area to volume for design optimization',
    'Surface_Area / (Max_Length * Max_Width * Max_Height)',
    'mm⁻¹',
    4,
    true
)
ON CONFLICT (calculator_id, formula_name) DO UPDATE SET
    formula_expression = EXCLUDED.formula_expression,
    output_unit = EXCLUDED.output_unit,
    decimal_places = EXCLUDED.decimal_places;

-- ============================================================================
-- SCALABLE TEMPLATE SYSTEM FOR FUTURE CALCULATORS
-- ============================================================================

-- Step 4: Create reusable function for adding calculated fields to any calculator
CREATE OR REPLACE FUNCTION add_calculated_fields_to_calculator(
    p_calculator_id UUID,
    p_fields JSONB -- Array of {field_name, display_label, unit, formula_expression}
) RETURNS TEXT AS $$
DECLARE
    field_data JSONB;
BEGIN
    -- Add calculated fields
    FOR field_data IN SELECT * FROM jsonb_array_elements(p_fields)
    LOOP
        -- Insert calculated field
        INSERT INTO calculator_fields (
            calculator_id,
            field_name,
            display_label,
            field_type,
            unit,
            display_order,
            is_required
        ) VALUES (
            p_calculator_id,
            field_data->>'field_name',
            field_data->>'display_label',
            'calculated',
            field_data->>'unit',
            COALESCE((field_data->>'display_order')::INTEGER, 100),
            false
        )
        ON CONFLICT (calculator_id, field_name) DO UPDATE SET
            display_label = EXCLUDED.display_label,
            unit = EXCLUDED.unit;
        
        -- Insert corresponding formula if provided
        IF field_data ? 'formula_expression' THEN
            INSERT INTO calculator_formulas (
                calculator_id,
                formula_name,
                display_label,
                formula_expression,
                output_unit,
                decimal_places,
                display_in_results
            ) VALUES (
                p_calculator_id,
                'calculate' || (field_data->>'field_name'),
                'Calculate ' || (field_data->>'display_label'),
                field_data->>'formula_expression',
                field_data->>'unit',
                COALESCE((field_data->>'decimal_places')::INTEGER, 2),
                true
            )
            ON CONFLICT (calculator_id, formula_name) DO UPDATE SET
                formula_expression = EXCLUDED.formula_expression,
                output_unit = EXCLUDED.output_unit;
        END IF;
    END LOOP;
    
    RETURN 'Successfully added ' || jsonb_array_length(p_fields) || ' calculated fields';
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create calculator validation function
CREATE OR REPLACE FUNCTION validate_calculator_completeness(p_calculator_id UUID)
RETURNS TABLE(
    calculator_name TEXT,
    total_fields INTEGER,
    input_fields INTEGER,
    calculated_fields INTEGER,
    total_formulas INTEGER,
    status TEXT,
    missing_components TEXT[]
) AS $$
DECLARE
    calc_name TEXT;
    input_count INTEGER;
    calc_count INTEGER;
    formula_count INTEGER;
    issues TEXT[] := '{}';
BEGIN
    -- Get calculator info
    SELECT name INTO calc_name FROM calculators WHERE id = p_calculator_id;
    
    -- Count fields by type
    SELECT 
        COUNT(CASE WHEN field_type != 'calculated' THEN 1 END),
        COUNT(CASE WHEN field_type = 'calculated' THEN 1 END)
    INTO input_count, calc_count
    FROM calculator_fields 
    WHERE calculator_id = p_calculator_id;
    
    -- Count formulas
    SELECT COUNT(*) INTO formula_count
    FROM calculator_formulas 
    WHERE calculator_id = p_calculator_id;
    
    -- Check for issues
    IF calc_count = 0 THEN
        issues := issues || 'No calculated fields defined';
    END IF;
    
    IF formula_count = 0 THEN
        issues := issues || 'No formulas defined';
    END IF;
    
    RETURN QUERY SELECT 
        calc_name,
        (input_count + calc_count),
        input_count,
        calc_count,
        formula_count,
        CASE WHEN array_length(issues, 1) IS NULL THEN 'COMPLETE' ELSE 'INCOMPLETE' END,
        issues;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFY THE FIX
-- ============================================================================

-- Check your specific calculator
SELECT * FROM validate_calculator_completeness('dce81348-b964-4294-99d3-dc15405cd9af'::uuid);

-- List all fields for verification
SELECT 
    field_name,
    display_label,
    field_type,
    unit,
    display_order
FROM calculator_fields 
WHERE calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
ORDER BY display_order NULLS LAST, field_type;

-- List all formulas
SELECT 
    formula_name,
    display_label,
    formula_expression,
    output_unit,
    decimal_places
FROM calculator_formulas 
WHERE calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
ORDER BY formula_name;

-- ============================================================================
-- EXAMPLE: How to add calculated fields to any future calculator
-- ============================================================================
/*
SELECT add_calculated_fields_to_calculator(
    'your-calculator-id'::uuid,
    '[
        {
            "field_name": "totalCost",
            "display_label": "Total Cost", 
            "unit": "USD",
            "display_order": 100,
            "formula_expression": "materialCost + laborCost + overheadCost",
            "decimal_places": 2
        },
        {
            "field_name": "profitMargin",
            "display_label": "Profit Margin", 
            "unit": "%",
            "display_order": 101,
            "formula_expression": "((sellingPrice - totalCost) / sellingPrice) * 100",
            "decimal_places": 1
        }
    ]'::jsonb
);
*/

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
SELECT 
    'CALCULATOR SYSTEM FIXED!' as status,
    'Now you have calculated fields and formulas' as message,
    'Results section will show calculated values' as next_step;
-- ============================================================================
-- ENTERPRISE CALCULATOR SYSTEM FIX
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

-- Step 2: For your specific calculator, add calculated output fields
-- This is the TEMPLATE for all future calculators

-- Add calculated fields (outputs that will show in Results section)
INSERT INTO calculator_fields (
    calculator_id,
    field_name,
    display_label,
    field_type,
    unit,
    display_order,
    is_required,
    default_value
) 
SELECT 
    'dce81348-b964-4294-99d3-dc15405cd9af'::uuid,
    field_name,
    display_label,
    'calculated' as field_type,
    unit,
    display_order,
    false as is_required,
    '' as default_value
FROM (VALUES
    ('volume', 'Calculated Volume', 'mm³', 100),
    ('density', 'Material Density', 'g/cm³', 101),
    ('surfaceVolumeRatio', 'Surface/Volume Ratio', 'mm⁻¹', 102)
) AS calc_fields(field_name, display_label, unit, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM calculator_fields cf2 
    WHERE cf2.calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid 
    AND cf2.field_name = calc_fields.field_name
);

-- Step 3: Add calculation formulas (the business logic)
INSERT INTO calculator_formulas (
    calculator_id,
    formula_name,
    display_label,
    description,
    expression,
    output_field_name,
    decimal_places,
    display_in_results,
    display_order
)
SELECT 
    'dce81348-b964-4294-99d3-dc15405cd9af'::uuid,
    formula_name,
    display_label,
    description,
    expression,
    output_field_name,
    decimal_places,
    display_in_results,
    display_order
FROM (VALUES
    (
        'calculateVolume',
        'Volume Calculation',
        'Calculates part volume from dimensions',
        'Max_Length * Max_Width * Max_Height',
        'volume',
        2,
        true,
        1
    ),
    (
        'calculateDensity',
        'Density Calculation', 
        'Calculates material density from weight and volume',
        'Weight / (Max_Length * Max_Width * Max_Height / 1000000)',
        'density',
        3,
        true,
        2
    ),
    (
        'calculateSurfaceVolumeRatio',
        'Surface to Volume Ratio',
        'Ratio of surface area to volume for design optimization',
        'Surface_Area / (Max_Length * Max_Width * Max_Height)',
        'surfaceVolumeRatio',
        4,
        true,
        3
    )
) AS formulas(formula_name, display_label, description, expression, output_field_name, decimal_places, display_in_results, display_order)
WHERE NOT EXISTS (
    SELECT 1 FROM calculator_formulas cf2 
    WHERE cf2.calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid 
    AND cf2.formula_name = formulas.formula_name
);

-- ============================================================================
-- SCALABLE TEMPLATE SYSTEM FOR FUTURE CALCULATORS
-- ============================================================================

-- Step 4: Create reusable function for adding calculated fields to any calculator
CREATE OR REPLACE FUNCTION add_calculated_fields_to_calculator(
    p_calculator_id UUID,
    p_fields JSONB -- Array of {field_name, display_label, unit, formula_expression}
) RETURNS TEXT AS $$
DECLARE
    field_record RECORD;
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
            (field_data->>'display_order')::INTEGER,
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
                expression,
                output_field_name,
                decimal_places,
                display_in_results
            ) VALUES (
                p_calculator_id,
                'calculate' || (field_data->>'field_name'),
                'Calculate ' || (field_data->>'display_label'),
                field_data->>'formula_expression',
                field_data->>'field_name',
                COALESCE((field_data->>'decimal_places')::INTEGER, 2),
                true
            )
            ON CONFLICT (calculator_id, formula_name) DO UPDATE SET
                expression = EXCLUDED.expression,
                output_field_name = EXCLUDED.output_field_name;
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
    
    IF calc_count != formula_count THEN
        issues := issues || 'Mismatch between calculated fields and formulas';
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
ORDER BY display_order;

-- List all formulas
SELECT 
    formula_name,
    display_label,
    expression,
    output_field_name
FROM calculator_formulas 
WHERE calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
ORDER BY display_order;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
SELECT 
    'CALCULATOR SYSTEM FIXED!' as status,
    'Now you have calculated fields and formulas' as message,
    'Results section will show calculated values' as next_step;
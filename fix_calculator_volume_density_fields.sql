-- ============================================================================
-- FIX CALCULATOR VOLUME, DENSITY, AND SURFACE VOLUME RATIO FIELDS
-- ============================================================================
-- The issue is that calculated fields need their formula stored in default_value
-- but they were created with empty default_value fields.

-- First, let's check the current state of the calculator
SELECT 
    'Current State' as check_type,
    c.name as calculator_name,
    cf.field_name,
    cf.display_label,
    cf.field_type,
    cf.default_value,
    cf.unit
FROM calculators c
LEFT JOIN calculator_fields cf ON c.id = cf.calculator_id
WHERE c.id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
AND cf.field_name IN ('volume', 'density', 'surfaceVolumeRatio')
ORDER BY cf.display_order;

-- Fix the calculated fields by updating their default_value with proper formulas
UPDATE calculator_fields 
SET default_value = 'Max_Length * Max_Width * Max_Height'
WHERE calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid 
AND field_name = 'volume' 
AND field_type = 'calculated';

UPDATE calculator_fields 
SET default_value = 'Weight / ((Max_Length * Max_Width * Max_Height) / 1000000)'
WHERE calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid 
AND field_name = 'density' 
AND field_type = 'calculated';

UPDATE calculator_fields 
SET default_value = 'Surface_Area / (Max_Length * Max_Width * Max_Height)'
WHERE calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid 
AND field_name = 'surfaceVolumeRatio' 
AND field_type = 'calculated';

-- Verify the fix
SELECT 
    'After Fix' as check_type,
    c.name as calculator_name,
    cf.field_name,
    cf.display_label,
    cf.field_type,
    cf.default_value,
    cf.unit
FROM calculators c
LEFT JOIN calculator_fields cf ON c.id = cf.calculator_id
WHERE c.id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
AND cf.field_name IN ('volume', 'density', 'surfaceVolumeRatio')
ORDER BY cf.display_order;

-- Also check what input fields are available for this calculator
SELECT 
    'Input Fields' as check_type,
    cf.field_name,
    cf.display_label,
    cf.field_type,
    cf.unit
FROM calculator_fields cf
WHERE cf.calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
AND cf.field_type != 'calculated'
ORDER BY cf.display_order;

-- Final verification - check complete calculator structure
SELECT 
    'Complete Structure' as check_type,
    cf.field_name,
    cf.display_label,
    cf.field_type,
    cf.default_value,
    cf.unit,
    cf.display_order
FROM calculator_fields cf
WHERE cf.calculator_id = 'dce81348-b964-4294-99d3-dc15405cd9af'::uuid
ORDER BY cf.display_order NULLS LAST, cf.field_type;
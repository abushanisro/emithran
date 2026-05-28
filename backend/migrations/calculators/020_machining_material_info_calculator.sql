-- ============================================================================
-- Calculator: Machining - Material Information
-- Category:   Material
-- Fields:     8 (1 Text, 2 Text, 3 DB Lookup, 2 Number)
-- Section:    RM Composition Analysis + Part Input Data
-- Run in:     Supabase SQL Editor
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_user_id UUID := '5572f34d-2f51-456e-a5d7-96f840128b50';
BEGIN
  INSERT INTO calculators (
    user_id, name, calc_category, calculator_type, is_template, is_public, description
  ) VALUES (
    v_user_id,
    'Machining - Material Information',
    'material',
    'single',
    false,
    false,
    'Machining material info – RM composition (XRF), material grade, density, price, part weight and MOQ'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- RM Composition Analysis
    (v_calc_id, 'XRF Code',            'XRF Code (RM Composition Analysis)', 'text',           NULL,      NULL,            1, false, NULL),

    -- Part Input Data
    (v_calc_id, 'Material Category',   'Material Category',                  'text',           NULL,      NULL,            2, false, 'Stainless Steel'),
    (v_calc_id, 'Material Grade',      'Material Grade',                     'text',           NULL,      NULL,            3, false, 'SS303'),

    -- DB Lookups
    (v_calc_id, 'Density',             'Density (g/cc)',                     'database_lookup','g/cc',    'raw_materials',  4, false, '7.9'),
    (v_calc_id, 'Material Price',      'Material Price (INR/Kg)',            'database_lookup','INR/Kg',  'raw_materials',  5, false, NULL),
    (v_calc_id, 'Scrap Price',         'Scrap Price (INR/Kg)',               'database_lookup','INR/Kg',  'raw_materials',  6, false, NULL),

    -- Part dimensions
    (v_calc_id, 'Part Weight',         'Part Weight (Kg)',                   'number',         'Kg',      NULL,            7, false, NULL),
    (v_calc_id, 'Part MOQ',            'Part MOQ (ton)',                     'number',         'ton',     NULL,            8, false, NULL);

  RAISE NOTICE 'Done — Machining Material Information, ID: %', v_calc_id;
END $$;

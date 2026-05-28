-- ============================================================================
-- Calculator: Shot Weight Calculator
-- Category:   Process
-- Fields:     11 (1 DB Lookup, 2 User Input, 2 Number, 6 Custom Formula)
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
    'Shot Weight Calculator',
    'process',
    'single',
    false,
    false,
    'Calculate shot weight including part weight and runner system weight'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Database Lookup
    (v_calc_id, 'Density',                      'Density',                      'database_lookup', 'Kg/m³', 'raw_materials',  1, false, NULL),

    -- User Input
    (v_calc_id, 'Volume of the part',            'Volume of the part',            'number',          'mm³',   NULL,             2, false, NULL),
    (v_calc_id, 'Finished Part Weight',          'Finished Part Weight',          'number',          'grams', NULL,             3, false, NULL),

    -- Number (with defaults)
    (v_calc_id, 'No of Cavity',                 'No of Cavity',                 'number',          'Nos',   NULL,             4, false, '1'),
    (v_calc_id, 'Runner Dia',                   'Runner Dia',                   'number',          'mm',    NULL,             5, false, '7'),

    -- Custom Formula
    (v_calc_id, 'Runner Length/Part 1',         'Runner Length/Part 1',         'calculated',      'mm',    NULL,             6, false, '125/{No of Cavity}'),
    (v_calc_id, 'Runner Projected Area /Part',  'Runner Projected Area /Part',  'calculated',      NULL,    NULL,             7, false, '{Runner Dia} * {Runner Length/Part 1}'),
    (v_calc_id, 'Runner Projected Volume /Part','Runner Projected Volume /Part','calculated',      'mm³',   NULL,             8, false, '(3.14 / 4) * {Runner Dia}^2 * {Runner Length/Part 1}'),
    (v_calc_id, 'Runner Weight/Part',           'Runner Weight/Part',           'calculated',      'Grams', NULL,             9, false, '({Runner Projected Volume /Part} * {Density}) / 1000000'),
    (v_calc_id, 'Total Shot Weight',            'Total Shot Weight',            'calculated',      NULL,    NULL,            10, false, '({Finished Part Weight} * {No of Cavity}) + ({Runner Weight/Part} * {No of Cavity})');

  RAISE NOTICE 'Done — Shot Weight Calculator, ID: %', v_calc_id;
END $$;

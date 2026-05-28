-- ============================================================================
-- Calculator: Sheet Metal Laser Cutting - Material Information
-- Category:   Material
-- Fields:     25 (3 Text, 3 DB Lookup, 9 Number, 10 Calculated)
-- Differences from 007 (TPP/Stamping material info):
--   - Part Allowance = Kerf width (user input, default 1mm) — NOT calculated from shear strength
--   - Shear Strength field removed (not needed for laser kerf)
--   - No. of Impressions removed
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
    'Sheet Metal Laser Cutting - Material Information',
    'material',
    'single',
    false,
    false,
    'Laser cutting material cost – parts per sheet using kerf allowance, weight, utilisation, net material cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Text inputs
    (v_calc_id, 'Category',              'Category',              'text',           NULL,   NULL,             1, false, 'Ferrous'),
    (v_calc_id, 'Family',                'Family',                'text',           NULL,   NULL,             2, false, 'HDG Steel'),
    (v_calc_id, 'Description Grade',     'Description/Grade',     'text',           NULL,   NULL,             3, false, NULL),

    -- DB Lookups
    (v_calc_id, 'Density',              'Density (g/cc)',         'database_lookup','g/cc', 'raw_materials',  4, false, '7.85'),
    (v_calc_id, 'Material Price',       'Material price ($/Kg)', 'database_lookup','$/Kg', 'raw_materials',  5, false, '1.5'),
    (v_calc_id, 'Scrap Price',          'Scrap price ($/Kg)',    'database_lookup','$/Kg', 'raw_materials',  6, false, '0.4'),

    -- Part dimensions (user input)
    (v_calc_id, 'Unfolded Length',      'Unfolded Length (mm)',  'number',         'mm',   NULL,             7, false, NULL),
    (v_calc_id, 'Unfolded Width',       'Unfolded Width (mm)',   'number',         'mm',   NULL,             8, false, NULL),
    (v_calc_id, 'Thickness',            'Thickness (mm)',         'number',         'mm',   NULL,             9, false, NULL),
    (v_calc_id, 'Net Weight Per Part',  'Net weight (g)',         'number',         'g',    NULL,            10, false, NULL),
    (v_calc_id, 'Area',                 'Area (mm²)',             'number',         'mm²',  NULL,            11, false, NULL),

    -- Kerf (Part Allowance) – user input / lookup table
    (v_calc_id, 'Part Allowance',       'Part allowance / Kerf (mm)', 'number',    'mm',   NULL,            13, false, '1'),

    -- Sheet parameters
    (v_calc_id, 'Sheet Width',          'Sheet Width (mm)',       'number',         'mm',   NULL,            14, false, '1250'),
    (v_calc_id, 'Sheet Length',         'Sheet Length (mm)',      'number',         'mm',   NULL,            15, false, '2500'),
    (v_calc_id, 'Edge Allowance',       'Edge Allowance (mm)',    'number',         'mm',   NULL,            16, false, '2'),
    (v_calc_id, 'Scrap Recovery',       'Scrap Recovery %',      'number',         '%',    NULL,            21, false, '90'),

    -- Calculated fields
    (v_calc_id, 'Volume',               'Volume (mm³)',           'calculated',     'mm³',  NULL,            12, false, NULL),
    (v_calc_id, 'Parts Per Sheet',      'Parts per Sheet',        'calculated',     NULL,   NULL,            17, false, NULL),
    (v_calc_id, 'Sheet Weight',         'Sheet Weight (g)',       'calculated',     'g',    NULL,            18, false, NULL),
    (v_calc_id, 'Gross Weight Per Part','Gross weight per part (g)', 'calculated',  'g',    NULL,            19, false, NULL),
    (v_calc_id, 'Scrap Weight Per Part','Scrap weight per part (g)', 'calculated',  'g',    NULL,            20, false, NULL),
    (v_calc_id, 'Utilisation',          'Utilisation %',          'calculated',     '%',    NULL,            22, false, NULL),
    (v_calc_id, 'Gross Material Cost',  'Gross Material cost ($)', 'calculated',   '$',    NULL,            23, false, NULL),
    (v_calc_id, 'Scrap Rec Cost',       'Scrap Rec Cost ($)',     'calculated',     '$',    NULL,            24, false, NULL),
    (v_calc_id, 'Net Material Cost',    'Net Material cost ($)',  'calculated',     '$',    NULL,            25, false, NULL);

  -- Formula expressions
  UPDATE calculator_fields SET default_value =
    '{Area} * {Thickness}'
  WHERE calculator_id = v_calc_id AND field_name = 'Volume';

  UPDATE calculator_fields SET default_value =
    '(({Sheet Width} - {Edge Allowance}) * ({Sheet Length} - {Edge Allowance})) / (({Unfolded Length} + {Part Allowance}) * ({Unfolded Width} + {Part Allowance}))'
  WHERE calculator_id = v_calc_id AND field_name = 'Parts Per Sheet';

  UPDATE calculator_fields SET default_value =
    '({Sheet Length} * {Sheet Width} * {Thickness} * {Density}) / 1000'
  WHERE calculator_id = v_calc_id AND field_name = 'Sheet Weight';

  UPDATE calculator_fields SET default_value =
    '{Sheet Weight} / {Parts Per Sheet}'
  WHERE calculator_id = v_calc_id AND field_name = 'Gross Weight Per Part';

  UPDATE calculator_fields SET default_value =
    '{Gross Weight Per Part} - {Net Weight Per Part}'
  WHERE calculator_id = v_calc_id AND field_name = 'Scrap Weight Per Part';

  UPDATE calculator_fields SET default_value =
    '({Net Weight Per Part} / {Gross Weight Per Part}) * 100'
  WHERE calculator_id = v_calc_id AND field_name = 'Utilisation';

  UPDATE calculator_fields SET default_value =
    '({Gross Weight Per Part} / 1000) * {Material Price}'
  WHERE calculator_id = v_calc_id AND field_name = 'Gross Material Cost';

  UPDATE calculator_fields SET default_value =
    '({Scrap Weight Per Part} / 1000) * ({Scrap Recovery} / 100) * {Scrap Price}'
  WHERE calculator_id = v_calc_id AND field_name = 'Scrap Rec Cost';

  UPDATE calculator_fields SET default_value =
    '{Gross Material Cost} - {Scrap Rec Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Net Material Cost';

  RAISE NOTICE 'Done — Sheet Metal Laser Cutting Material Information, ID: %', v_calc_id;
END $$;

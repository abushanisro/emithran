-- ============================================================================
-- Calculator: Sheet Metal Drawing/Forming - Material Information
-- Category:   Material
-- Fields:     27 (3 Text, 4 DB Lookup, 9 Number, 11 Calculated)
-- Differences from flat-sheet material info (007):
--   - Uses Coil Width/Length instead of Sheet Width/Length
--   - Start & End Scrap Length replaces Edge Allowance
--   - No Of Impressions is a calculated field
--   - Parts Per Coil / Coil Weight instead of Parts Per Sheet / Sheet Weight
-- Note: Part Allowance has a "+10mm if impressions > 1" condition that must
--       be applied manually by the user when No Of Impressions > 1
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
    'Sheet Metal Drawing/Forming - Material Information',
    'material',
    'single',
    false,
    false,
    'Drawing/Forming coil-fed material cost – blank weight, impressions, utilisation, net material cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Text inputs
    (v_calc_id, 'Category',              'Category',              'text',           NULL,    NULL,             1, false, 'Ferrous'),
    (v_calc_id, 'Family',                'Family',                'text',           NULL,    NULL,             2, false, 'HDG Steel'),
    (v_calc_id, 'Description Grade',     'Description/Grade',     'text',           NULL,    NULL,             3, false, NULL),

    -- DB Lookups
    (v_calc_id, 'Density',              'Density (g/cc)',         'database_lookup','g/cc',  'raw_materials',  4, false, '7.85'),
    (v_calc_id, 'Material Price',       'Material price ($/Kg)', 'database_lookup','$/Kg',  'raw_materials',  5, false, '1.5'),
    (v_calc_id, 'Scrap Price',          'Scrap price ($/Kg)',    'database_lookup','$/Kg',  'raw_materials',  6, false, '0.4'),
    (v_calc_id, 'Shear Strength',       'Shear Strength (Mpa)',  'database_lookup','Mpa',   'raw_materials',  7, false, NULL),

    -- Part dimensions (user input)
    (v_calc_id, 'Unfolded Length',      'Unfolded Length (mm)',  'number',         'mm',    NULL,             8, false, NULL),
    (v_calc_id, 'Unfolded Width',       'Unfolded Width (mm)',   'number',         'mm',    NULL,             9, false, NULL),
    (v_calc_id, 'Thickness',            'Thickness (mm)',         'number',         'mm',    NULL,            10, false, NULL),
    (v_calc_id, 'Net Weight Per Part',  'Net weight (g)',         'number',         'g',     NULL,            11, false, NULL),
    (v_calc_id, 'Area',                 'Area (mm²)',             'number',         'mm²',   NULL,            12, false, NULL),

    -- Coil parameters
    (v_calc_id, 'Coil Width',           'Coil/Sheet Width (mm)', 'number',         'mm',    NULL,            16, false, '300'),
    (v_calc_id, 'Coil Length',          'Coil/Sheet Length (mm)','number',         'mm',    NULL,            17, false, '300'),
    (v_calc_id, 'Start End Scrap',      'Start & End Scrap Length (mm)', 'number', 'mm',    NULL,            18, false, '5'),
    (v_calc_id, 'Scrap Recovery',       'Scrap Recovery %',      'number',         '%',     NULL,            24, false, '90'),

    -- Calculated fields
    (v_calc_id, 'Volume',               'Volume (mm³)',           'calculated',     'mm³',   NULL,            13, false, NULL),
    (v_calc_id, 'Part Allowance',       'Part allowance (mm)',   'calculated',     'mm',    NULL,            14, false, NULL),
    (v_calc_id, 'No Of Impressions',    'No. of Impressions',    'calculated',     NULL,    NULL,            15, false, NULL),
    (v_calc_id, 'Parts Per Coil',       'Parts per Coil',        'calculated',     NULL,    NULL,            19, false, NULL),
    (v_calc_id, 'Coil Weight',          'Coil/Sheet Weight (g)', 'calculated',     'g',     NULL,            20, false, NULL),
    (v_calc_id, 'Gross Weight Per Part','Gross weight per part (g)', 'calculated', 'g',     NULL,            21, false, NULL),
    (v_calc_id, 'Scrap Weight Per Part','Scrap weight per part (g)', 'calculated', 'g',     NULL,            22, false, NULL),
    (v_calc_id, 'Utilisation',          'Utilisation %',         'calculated',     '%',     NULL,            23, false, NULL),
    (v_calc_id, 'Gross Material Cost',  'Gross Material cost ($)','calculated',    '$',     NULL,            25, false, NULL),
    (v_calc_id, 'Scrap Rec Cost',       'Scrap Rec Cost ($)',    'calculated',     '$',     NULL,            26, false, NULL),
    (v_calc_id, 'Net Material Cost',    'Net Material cost ($)', 'calculated',     '$',     NULL,            27, false, NULL);

  -- Formula expressions
  UPDATE calculator_fields SET default_value =
    '{Area} * {Thickness}'
  WHERE calculator_id = v_calc_id AND field_name = 'Volume';

  -- Base formula; user adds 10mm manually when No Of Impressions > 1
  UPDATE calculator_fields SET default_value =
    '{Thickness} * (({Shear Strength} / 10) ^ 0.5) * 0.01'
  WHERE calculator_id = v_calc_id AND field_name = 'Part Allowance';

  UPDATE calculator_fields SET default_value =
    '({Coil Width} - {Start End Scrap}) / ({Unfolded Length} + {Part Allowance})'
  WHERE calculator_id = v_calc_id AND field_name = 'No Of Impressions';

  UPDATE calculator_fields SET default_value =
    '(({Coil Width} - {Start End Scrap}) * ({Coil Length} - {Start End Scrap})) / (({Unfolded Length} + {Part Allowance}) * ({Unfolded Width} + {Part Allowance}))'
  WHERE calculator_id = v_calc_id AND field_name = 'Parts Per Coil';

  UPDATE calculator_fields SET default_value =
    '({Coil Length} * {Coil Width} * {Thickness} * {Density}) / 1000'
  WHERE calculator_id = v_calc_id AND field_name = 'Coil Weight';

  UPDATE calculator_fields SET default_value =
    '{Coil Weight} / {Parts Per Coil}'
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

  RAISE NOTICE 'Done — Sheet Metal Drawing/Forming Material Information, ID: %', v_calc_id;
END $$;

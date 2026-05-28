-- ============================================================================
-- Calculator: Sheet Metal - Stamping Manufacturing
-- Category:   Process
-- Fields:     17 (1 Select, 1 Text, 6 Number input, 1 DB Lookup, 3 Calculated, 3 Number, 2 Number)
-- Note:       field_name uses no parentheses/special chars (formula engine safety)
--             display_label carries the human-readable label
-- Key diff from TPP:
--   - No. Of Impressions multiplies into Theoretical Force
--   - Setup Time uses Tool Loading Time + Total Coil Loading Time
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
    'Sheet Metal - Stamping Manufacturing',
    'process',
    'single',
    false,
    false,
    'Sheet Metal Stamping – manufacturing parameters up to cycle time'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'Process Type',          'Process Type',                               'select',         NULL,  NULL,            1,  false, 'Stamping'),
    (v_calc_id, 'Length Of Cut',         'Length Of Cut : (Internal & External) (mm)', 'number',         'mm',  NULL,            2,  false, NULL),
    (v_calc_id, 'No Of Impressions',     'No. of Impressions',                          'number',          NULL,  NULL,            3,  false, NULL),
    (v_calc_id, 'Thickness',             'Thickness (mm)',                              'number',         'mm',  NULL,            4,  false, NULL),
    (v_calc_id, 'Shear Strength',        'Shear Strength Of Material (Mpa)',           'database_lookup','Mpa', 'raw_materials',  5,  false, NULL),
    (v_calc_id, 'Theoretical Force',     'Theoretical Force (Ton)',                    'calculated',     'Ton', NULL,             6,  false, NULL),
    (v_calc_id, 'Recommended Force',     'Recommended Force (Ton)',                    'calculated',     'Ton', NULL,             7,  false, NULL),
    (v_calc_id, 'Selected Tonnage',      'Selected Tonnage (T)',                        'number',         'T',   NULL,            8,  false, NULL),
    (v_calc_id, 'Machine Name',          'Machine Name',                               'text',            NULL,  NULL,            9,  false, NULL),
    (v_calc_id, 'Machine Automation',    'M/c Automation',                             'select',          NULL,  NULL,           10,  false, 'Auto'),
    (v_calc_id, 'Cycle Time',            'Cycle Time (sec)',                            'number',         'sec', NULL,           11,  false, NULL),
    (v_calc_id, 'Tool Loading Time',     'Tool Loading Time (min)',                     'number',         'min', NULL,           12,  false, NULL),
    (v_calc_id, 'Total Coil Loading Time','Total Coil/Sheet Loading Time (min)',        'number',         'min', NULL,           13,  false, NULL),
    (v_calc_id, 'Lot Size',              'Lot size (#)',                                'number',          NULL,  NULL,           14,  false, NULL),
    (v_calc_id, 'Setup Time',            'Setup Time (min/piece)',                      'calculated',     'min', NULL,           15,  false, NULL),
    (v_calc_id, 'Direct Labors',         '# of Direct Labors',                         'number',          NULL,  NULL,           16,  false, '1'),
    (v_calc_id, 'Skilled Labors',        '# of Skilled Labors',                        'number',          NULL,  NULL,           17,  false, '1');

  -- Formula expressions
  UPDATE calculator_fields SET default_value =
    '({Length Of Cut} * {Thickness} * {Shear Strength} * {No Of Impressions}) / 9810'
  WHERE calculator_id = v_calc_id AND field_name = 'Theoretical Force';

  UPDATE calculator_fields SET default_value =
    '{Theoretical Force} * 1.25'
  WHERE calculator_id = v_calc_id AND field_name = 'Recommended Force';

  UPDATE calculator_fields SET default_value =
    '({Tool Loading Time} + {Total Coil Loading Time}) / {Lot Size}'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Time';

  RAISE NOTICE 'Done — Sheet Metal Stamping Manufacturing, ID: %', v_calc_id;
END $$;

-- ============================================================================
-- Calculator: Sheet Metal - Drawing/Forming Manufacturing
-- Category:   Process
-- Fields:     22 (1 Select, 1 Text, 7 Number input, 1 DB Lookup, 5 Calculated, 4 Number, 2 Number)
-- Key formulas:
--   Punch Perimeter = Form Perimeter * 0.95
--   Drawing Force   = (Punch Perimeter * Thickness * Yield Strength * (Form Perimeter / Punch Perimeter - 0.7)) / 9810
--   Theoretical Force = Drawing Force * (4/3) * No Of Impressions
--     (4/3 absorbs Blank Holding Force = Fd/3, removed from display per spec)
--   Recommended Force = Theoretical Force * 1.25
--   Setup Time = Tool Loading Time / Lot Size
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
    'Sheet Metal - Drawing/Forming Manufacturing',
    'process',
    'single',
    false,
    false,
    'Sheet Metal Deep Drawing/Forming – manufacturing parameters up to cycle time'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'Process Type',       'Process Type',                                  'select',         NULL,  NULL,            1,  false, 'Drawing/Forming'),
    (v_calc_id, 'No Of Impressions',  'No. of Impressions',                             'number',          NULL,  NULL,            2,  false, NULL),
    (v_calc_id, 'Form Length',        'Form Length (mm)',                               'number',         'mm',  NULL,            3,  false, NULL),
    (v_calc_id, 'Form Perimeter',     'Form Perimeter (mm)',                            'number',         'mm',  NULL,            4,  false, NULL),
    (v_calc_id, 'Form Height',        'Form Height (mm)',                               'number',         'mm',  NULL,            5,  false, NULL),
    (v_calc_id, 'Punch Perimeter',    'Punch Perimeter (mm)',                           'calculated',     'mm',  NULL,            6,  false, NULL),
    (v_calc_id, 'H L Factor',         '(h/L) Factor',                                  'calculated',      NULL,  NULL,            7,  false, NULL),
    (v_calc_id, 'Thickness',          'Thickness (mm)',                                 'number',         'mm',  NULL,            8,  false, NULL),
    (v_calc_id, 'Yield Strength',     'Yield Strength Of Material (Mpa)',              'database_lookup','Mpa', 'raw_materials',  9,  false, NULL),
    (v_calc_id, 'Drawing Force',      'Drawing Force (Ton)',                            'calculated',     'Ton', NULL,            10, false, NULL),
    (v_calc_id, 'Theoretical Force',  'Theoretical Force (Ton)',                        'calculated',     'Ton', NULL,            11, false, NULL),
    (v_calc_id, 'Recommended Force',  'Recommended Force (Ton)',                        'calculated',     'Ton', NULL,            12, false, NULL),
    (v_calc_id, 'Selected Tonnage',   'Selected Tonnage (T)',                           'number',         'T',   NULL,            13, false, NULL),
    (v_calc_id, 'Machine Name',       'Machine Name',                                  'text',             NULL,  NULL,            14, false, NULL),
    (v_calc_id, 'Machine Automation', 'M/c Automation',                                'select',           NULL,  NULL,            15, false, 'Manual'),
    (v_calc_id, 'Cycle Time',         'Cycle Time (sec)',                               'number',         'sec', NULL,            16, false, NULL),
    (v_calc_id, 'Tool Loading Time',  'Tool Loading Time (min)',                        'number',         'min', NULL,            17, false, NULL),
    (v_calc_id, 'Sheet Loading Time', 'Total Coil/Sheet Loading Time (min)',            'number',         'min', NULL,            18, false, NULL),
    (v_calc_id, 'Lot Size',           'Lot size (#)',                                   'number',          NULL,  NULL,            19, false, NULL),
    (v_calc_id, 'Setup Time',         'Setup Time (min/piece)',                         'calculated',     'min', NULL,            20, false, NULL),
    (v_calc_id, 'Direct Labors',      '# of Direct Labors',                            'number',          NULL,  NULL,            21, false, '1'),
    (v_calc_id, 'Skilled Labors',     '# of Skilled Labors',                           'number',          NULL,  NULL,            22, false, '1');

  -- Formula expressions
  UPDATE calculator_fields SET default_value =
    '{Form Perimeter} * 0.95'
  WHERE calculator_id = v_calc_id AND field_name = 'Punch Perimeter';

  UPDATE calculator_fields SET default_value =
    '{Form Height} / {Form Length}'
  WHERE calculator_id = v_calc_id AND field_name = 'H L Factor';

  -- Fd = (Dp * T * Y * (Fp/Dp - 0.7)) / 9810
  UPDATE calculator_fields SET default_value =
    '({Punch Perimeter} * {Thickness} * {Yield Strength} * ({Form Perimeter} / {Punch Perimeter} - 0.7)) / 9810'
  WHERE calculator_id = v_calc_id AND field_name = 'Drawing Force';

  -- F = (Fd + Fd/3) * No Of Impressions = Fd * (4/3) * No Of Impressions
  UPDATE calculator_fields SET default_value =
    '{Drawing Force} * (4/3) * {No Of Impressions}'
  WHERE calculator_id = v_calc_id AND field_name = 'Theoretical Force';

  UPDATE calculator_fields SET default_value =
    '{Theoretical Force} * 1.25'
  WHERE calculator_id = v_calc_id AND field_name = 'Recommended Force';

  UPDATE calculator_fields SET default_value =
    '{Tool Loading Time} / {Lot Size}'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Time';

  RAISE NOTICE 'Done — Sheet Metal Drawing/Forming Manufacturing, ID: %', v_calc_id;
END $$;

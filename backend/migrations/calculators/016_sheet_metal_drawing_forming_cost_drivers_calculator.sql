-- ============================================================================
-- Calculator: Sheet Metal - Drawing/Forming Cost Drivers
-- Category:   Process
-- Fields:     22 (8 Number inputs from linked calculators, 7 Rate inputs, 6 Calculated, 1 Number)
-- Key difference from standard cost drivers:
--   Machine Cost = (MHR/60) * (Cycle Time/60) / No Of Impressions
--   Labor Cost   = (DLR/60) * Direct Labors * (Cycle Time/60) / No Of Impressions
-- Corrected Yield Cost formula:
--   (1 - Yield%) * (NMC + Machine + Labor + Setup + Inspection - Net Weight/1000 * Scrap Price)
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
    'Sheet Metal - Drawing/Forming Cost Drivers',
    'process',
    'single',
    false,
    false,
    'Drawing/Forming cost driver calculations – machine, setup, labor, inspection, yield, net process cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Inputs from Material Info calculator
    (v_calc_id, 'Net Material Cost',   'Net Material cost ($)',          'number', '$',    NULL,  1, false, NULL),
    (v_calc_id, 'Net Weight',          'Net weight (g)',                  'number', 'g',    NULL,  2, false, NULL),
    (v_calc_id, 'Scrap Price',         'Scrap price ($/Kg)',             'number', '$/Kg', NULL,  3, false, NULL),

    -- Inputs from Drawing/Forming Manufacturing calculator
    (v_calc_id, 'Cycle Time',          'Cycle Time (sec)',               'number', 'sec',  NULL,  4, false, NULL),
    (v_calc_id, 'No Of Impressions',   'No. of Impressions',             'number', NULL,   NULL,  5, false, '1'),
    (v_calc_id, 'Setup Time',          'Setup Time (min/piece)',          'number', 'min',  NULL,  6, false, NULL),
    (v_calc_id, 'Direct Labors',       '# of Direct Labors',             'number', NULL,   NULL,  7, false, '1'),
    (v_calc_id, 'Skilled Labors',      '# of Skilled Labors',            'number', NULL,   NULL,  8, false, '1'),
    (v_calc_id, 'Lot Size',            'Lot size (#)',                    'number', NULL,   NULL,  9, false, NULL),

    -- Rate inputs (country/machine tables)
    (v_calc_id, 'Direct Labor Rate',   'Direct Labor Rate /hr',          'number', '$/hr', NULL, 10, false, '30'),
    (v_calc_id, 'Skilled Labor Rate',  'Skilled Labor Rate /hr',         'number', '$/hr', NULL, 11, false, '45'),
    (v_calc_id, 'QA Inspector Rate',   'QA Inspector Rate /hr',          'number', '$/hr', NULL, 12, false, '50'),
    (v_calc_id, 'Sampling Rate',       'Sampling Rate (%)',               'number', '%',    NULL, 13, false, '1'),
    (v_calc_id, 'Inspection Time',     'Inspection time (min)',           'number', 'min',  NULL, 14, false, '0.5'),
    (v_calc_id, 'Yield',               'Yield (Net Good Parts) (%)',     'number', '%',    NULL, 15, false, '98'),
    (v_calc_id, 'Machine Hour Rate',   'Machine hour Rate ($)',           'number', '$/hr', NULL, 16, false, '15'),

    -- Calculated
    (v_calc_id, 'Machine Cost',        'Machine Cost ($)',                'calculated', '$', NULL, 17, false, NULL),
    (v_calc_id, 'Setup Cost',          'Setup Cost ($)',                  'calculated', '$', NULL, 18, false, NULL),
    (v_calc_id, 'Labor Cost',          'Labor Cost ($)',                  'calculated', '$', NULL, 19, false, NULL),
    (v_calc_id, 'Inspection Cost',     'Inspection Cost ($)',             'calculated', '$', NULL, 20, false, NULL),
    (v_calc_id, 'Yield Cost',          'Yield Cost ($)',                  'calculated', '$', NULL, 21, false, NULL),
    (v_calc_id, 'Net Process Cost',    'Net Process cost ($)',            'calculated', '$', NULL, 22, false, NULL);

  -- Formula expressions
  -- Machine Cost divided by No Of Impressions
  UPDATE calculator_fields SET default_value =
    '(({Machine Hour Rate} / 60) * ({Cycle Time} / 60)) / {No Of Impressions}'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value =
    '(({Direct Labor Rate} / 60) * {Direct Labors} * {Setup Time}) + (({Skilled Labor Rate} / 60) * {Skilled Labors} * {Setup Time}) + (({Machine Hour Rate} / 60) * {Setup Time})'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  -- Labor Cost divided by No Of Impressions
  UPDATE calculator_fields SET default_value =
    '(({Direct Labor Rate} / 60) * {Direct Labors} * ({Cycle Time} / 60)) / {No Of Impressions}'
  WHERE calculator_id = v_calc_id AND field_name = 'Labor Cost';

  UPDATE calculator_fields SET default_value =
    '({QA Inspector Rate} / 60) * {Inspection Time} * ({Sampling Rate} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Inspection Cost';

  UPDATE calculator_fields SET default_value =
    '(1 - ({Yield} / 100)) * ({Net Material Cost} + {Machine Cost} + {Labor Cost} + {Setup Cost} + {Inspection Cost} - ({Net Weight} / 1000 * {Scrap Price}))'
  WHERE calculator_id = v_calc_id AND field_name = 'Yield Cost';

  UPDATE calculator_fields SET default_value =
    '{Machine Cost} + {Setup Cost} + {Labor Cost} + {Inspection Cost} + {Yield Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Net Process Cost';

  RAISE NOTICE 'Done — Sheet Metal Drawing/Forming Cost Drivers, ID: %', v_calc_id;
END $$;

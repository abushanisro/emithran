-- ============================================================================
-- Calculator: Sheet Metal - Laser Cutting Cost Drivers
-- Category:   Process
-- Fields:     21 (7 Number inputs from linked calculators, 8 Rate/Cost inputs, 6 Calculated)
-- Note: "Cycle Time" for laser cutting = Total Time (sec) from manufacturing calculator.
--       Machine Cost and Labor Cost both convert Total Time: (Total Time / 60) = minutes.
-- Corrected Yield Cost formula (matches spec example values):
--   (1 - Yield%) * (Net Material Cost + Machine + Labor + Setup + Inspection - (Net Weight/1000 * Scrap Price))
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
    'Sheet Metal - Laser Cutting Cost Drivers',
    'process',
    'single',
    false,
    false,
    'Laser Cutting cost driver calculations – machine, setup, labor, inspection, yield, net process cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Inputs carried from Material Info calculator
    (v_calc_id, 'Net Material Cost',   'Net Material cost ($)',          'number', '$',     NULL, 1,  false, NULL),
    (v_calc_id, 'Net Weight',          'Net weight (g)',                  'number', 'g',     NULL, 2,  false, NULL),
    (v_calc_id, 'Scrap Price',         'Scrap price ($/Kg)',             'number', '$/Kg',  NULL, 3,  false, NULL),

    -- Inputs carried from Laser Cutting Manufacturing calculator
    (v_calc_id, 'Total Time',          'Total Time / Cycle Time (sec)',  'number', 'sec',   NULL, 4,  false, NULL),
    (v_calc_id, 'Setup Time',          'Setup Time (min/piece)',          'number', 'min',   NULL, 5,  false, NULL),
    (v_calc_id, 'Direct Labors',       '# of Direct Labors',             'number', NULL,    NULL, 6,  false, '0.5'),
    (v_calc_id, 'Skilled Labors',      '# of Skilled Labors',            'number', NULL,    NULL, 7,  false, '0'),
    (v_calc_id, 'Lot Size',            'Lot size (#)',                    'number', NULL,    NULL, 8,  false, NULL),

    -- Rate inputs (from country/machine tables)
    (v_calc_id, 'Direct Labor Rate',   'Direct Labor Rate /hr',          'number', '$/hr',  NULL, 9,  false, '30'),
    (v_calc_id, 'Skilled Labor Rate',  'Skilled Labor Rate /hr',         'number', '$/hr',  NULL, 10, false, '45'),
    (v_calc_id, 'QA Inspector Rate',   'QA Inspector Rate /hr',          'number', '$/hr',  NULL, 11, false, '50'),
    (v_calc_id, 'Sampling Rate',       'Sampling Rate (%)',               'number', '%',     NULL, 12, false, '1'),
    (v_calc_id, 'Inspection Time',     'Inspection time (min)',           'number', 'min',   NULL, 13, false, '0.5'),
    (v_calc_id, 'Yield',               'Yield (Net Good Parts) (%)',     'number', '%',     NULL, 14, false, '98'),
    (v_calc_id, 'Machine Hour Rate',   'Machine hour Rate ($)',           'number', '$/hr',  NULL, 15, false, '30'),

    -- Calculated cost fields
    (v_calc_id, 'Machine Cost',        'Machine Cost ($)',                'calculated', '$', NULL, 16, false, NULL),
    (v_calc_id, 'Setup Cost',          'Setup Cost ($)',                  'calculated', '$', NULL, 17, false, NULL),
    (v_calc_id, 'Labor Cost',          'Labor Cost ($)',                  'calculated', '$', NULL, 18, false, NULL),
    (v_calc_id, 'Inspection Cost',     'Inspection Cost ($)',             'calculated', '$', NULL, 19, false, NULL),
    (v_calc_id, 'Yield Cost',          'Yield Cost ($)',                  'calculated', '$', NULL, 20, false, NULL),
    (v_calc_id, 'Net Process Cost',    'Net Process cost ($)',            'calculated', '$', NULL, 21, false, NULL);

  -- Formula expressions
  -- Machine Cost: Total Time is in sec → divide by 60 to get minutes
  UPDATE calculator_fields SET default_value =
    '({Machine Hour Rate} / 60) * ({Total Time} / 60)'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value =
    '(({Direct Labor Rate} / 60) * {Direct Labors} * {Setup Time}) + (({Skilled Labor Rate} / 60) * {Skilled Labors} * {Setup Time}) + (({Machine Hour Rate} / 60) * {Setup Time})'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  -- Labor Cost: Total Time in sec → convert to min
  UPDATE calculator_fields SET default_value =
    '({Direct Labor Rate} / 60) * {Direct Labors} * ({Total Time} / 60)'
  WHERE calculator_id = v_calc_id AND field_name = 'Labor Cost';

  UPDATE calculator_fields SET default_value =
    '({QA Inspector Rate} / 60) * {Inspection Time} * ({Sampling Rate} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Inspection Cost';

  -- Yield Cost (corrected): (1-yield%) * (total spend - scrap recovery on rejected part)
  UPDATE calculator_fields SET default_value =
    '(1 - ({Yield} / 100)) * ({Net Material Cost} + {Machine Cost} + {Labor Cost} + {Setup Cost} + {Inspection Cost} - ({Net Weight} / 1000 * {Scrap Price}))'
  WHERE calculator_id = v_calc_id AND field_name = 'Yield Cost';

  UPDATE calculator_fields SET default_value =
    '{Machine Cost} + {Setup Cost} + {Labor Cost} + {Inspection Cost} + {Yield Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Net Process Cost';

  RAISE NOTICE 'Done — Sheet Metal Laser Cutting Cost Drivers, ID: %', v_calc_id;
END $$;

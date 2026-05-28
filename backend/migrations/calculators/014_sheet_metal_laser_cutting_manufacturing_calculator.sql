-- ============================================================================
-- Calculator: Sheet Metal - Laser Cutting Manufacturing
-- Category:   Process
-- Fields:     16 (2 Select, 2 Text, 5 Number input, 3 Calculated, 2 Number, 2 Number)
-- Key formulas:
--   Cutting Time (min)  = Cutting Length / (Cutting Speed * 1000)
--                         [Length in mm, Speed in m/min → convert: Speed * 1000 = mm/min]
--   Piercing Time (min) = Piercing Time Per Start * No Of Starts
--   Total Time (sec)    = (Cutting Time + Piercing Time) * 60
--   Setup Time (min/pc) = Sheet Loading Time / Lot Size
-- Note: Cycle Time and Recommend (T) remaoved per spec.
--       Total Time is the effective cycle time for this process.
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
    'Sheet Metal - Laser Cutting Manufacturing',
    'process',
    'single',
    false,
    false,
    'Laser Cutting – manufacturing parameters: cutting/piercing time, setup time'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Process inputs
    (v_calc_id, 'Process Type',           'Process Type',                        'select', NULL,    NULL,  1,  false, 'Laser Cutting'),
    (v_calc_id, 'Cutting Length',         'Cutting Length (mm)',                 'number', 'mm',    NULL,  2,  false, NULL),
    (v_calc_id, 'No Of Starts',           'No. of Starts / Piercings (Count)',  'number', NULL,    NULL,  3,  false, NULL),

    -- Lookup inputs (from machine/material tables)
    (v_calc_id, 'Cutting Speed',          'Cutting Speed (m/min)',               'number', 'm/min', NULL,  4,  false, NULL),
    (v_calc_id, 'Piercing Time Per Start','Piercing Time Per Start (min)',       'number', 'min',   NULL,  5,  false, NULL),

    -- Calculated time fields
    (v_calc_id, 'Cutting Time',           'Cutting Time (min)',                  'calculated', 'min', NULL, 6, false, NULL),
    (v_calc_id, 'Piercing Time',          'Piercing Time (min)',                 'calculated', 'min', NULL, 7, false, NULL),
    (v_calc_id, 'Total Time',             'Total Time (sec)',                    'calculated', 'sec', NULL, 8, false, NULL),

    -- Machine inputs
    (v_calc_id, 'Laser Machine Power',    'Laser Cutting Machine (W)',           'text',   NULL,    NULL,  9,  false, '6000 W'),
    (v_calc_id, 'Machine Name',           'Machine Name',                        'text',   NULL,    NULL, 10,  false, 'Trulaser'),
    (v_calc_id, 'Machine Automation',     'M/c Automation',                      'select', NULL,    NULL, 11,  false, 'Auto'),

    -- Setup inputs
    (v_calc_id, 'Sheet Loading Time',     'Sheet Loading/Unloading Time (min)', 'number', 'min',   NULL, 12,  false, NULL),
    (v_calc_id, 'Lot Size',               'Lot size (#)',                        'number', NULL,    NULL, 13,  false, NULL),
    (v_calc_id, 'Setup Time',             'Setup Time (min/piece)',              'calculated', 'min', NULL, 14, false, NULL),

    -- Labor inputs
    (v_calc_id, 'Direct Labors',          '# of Direct Labors',                 'number', NULL,    NULL, 15,  false, '0.5'),
    (v_calc_id, 'Skilled Labors',         '# of Skilled Labors',                'number', NULL,    NULL, 16,  false, '0');

  -- Formula expressions
  -- CT = L (mm) / (N (m/min) * 1000) → result in min
  UPDATE calculator_fields SET default_value =
    '{Cutting Length} / ({Cutting Speed} * 1000)'
  WHERE calculator_id = v_calc_id AND field_name = 'Cutting Time';

  -- PT = X (min/pierce) * P (count)
  UPDATE calculator_fields SET default_value =
    '{Piercing Time Per Start} * {No Of Starts}'
  WHERE calculator_id = v_calc_id AND field_name = 'Piercing Time';

  -- Total Time in seconds: (CT + PT) * 60
  UPDATE calculator_fields SET default_value =
    '({Cutting Time} + {Piercing Time}) * 60'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Time';

  UPDATE calculator_fields SET default_value =
    '{Sheet Loading Time} / {Lot Size}'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Time';

  RAISE NOTICE 'Done — Sheet Metal Laser Cutting Manufacturing, ID: %', v_calc_id;
END $$;

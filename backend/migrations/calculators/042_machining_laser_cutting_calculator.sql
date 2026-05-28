-- ============================================================================
-- Calculator: Machining - Laser Cutting
-- Category:   Process
-- Fields:     21 (8 W/C, 2 process, 11 calculated)
-- Formula:
--   Machining Time (min) = Length of Cut / Feed Rate
-- Run in: Supabase SQL Editor
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
    'Machining - Laser Cutting',
    'process',
    'single',
    false,
    false,
    'Laser cutting – machining time = length / feed rate, full cost breakdown'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',       'MHR/hour (INR/hr)',         'number', 'INR/hr', NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',       'LHR/hour (INR/hr)',         'number', 'INR/hr', NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                'OLE (%)',                   'number', '%',      NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',   'Setup Percentage (%)',      'number', '%',      NULL,  4, false, '30'),
    (v_calc_id, 'Tool Code',          'Tool Code',                 'text',   NULL,     NULL,  5, false, '0'),
    (v_calc_id, 'Tool Cost',          'Tool Cost (INR)',            'number', 'INR',    NULL,  6, false, '0'),
    (v_calc_id, 'Tool Life',          'Tool Life (Parts)',          'number', 'Parts',  NULL,  7, false, '0'),
    (v_calc_id, 'No of Uses',         'No. of Uses',               'number', NULL,     NULL,  8, false, '1'),

    (v_calc_id, 'Length of Cut',      'Length of Cut (mm)',        'number', 'mm',     NULL,  9, false, NULL),
    (v_calc_id, 'Feed Rate',          'Feed Rate (mm/min)',        'number', 'mm/min', NULL, 10, false, NULL),

    (v_calc_id, 'Machining Time Min', 'Machining Time (min)',      'calculated', 'min', NULL, 11, false, NULL),
    (v_calc_id, 'Machining Time',     'Machining Time (s)',        'calculated', 's',   NULL, 12, false, NULL),
    (v_calc_id, 'Time per Use',       'Time per Use (s)',          'calculated', 's',   NULL, 13, false, NULL),
    (v_calc_id, 'Total Time',         'Total Time (s)',            'calculated', 's',   NULL, 14, false, NULL),
    (v_calc_id, 'Tool Cost per Part', 'Tool Cost/Part (INR)',      'calculated', 'INR', NULL, 15, false, NULL),
    (v_calc_id, 'Machine Cost',       'Machine Cost (INR)',        'calculated', 'INR', NULL, 16, false, NULL),
    (v_calc_id, 'Labour Cost',        'Labour Cost (INR)',         'calculated', 'INR', NULL, 17, false, NULL),
    (v_calc_id, 'Process Cost',       'Process Cost (INR)',        'calculated', 'INR', NULL, 18, false, NULL),
    (v_calc_id, 'Setup Cost',         'Setup Cost (INR)',          'calculated', 'INR', NULL, 19, false, NULL),
    (v_calc_id, 'Total Process Cost', 'Total Process Cost (INR)', 'calculated', 'INR', NULL, 20, false, NULL);

  UPDATE calculator_fields SET default_value = '{Length of Cut} / {Feed Rate}'
  WHERE calculator_id = v_calc_id AND field_name = 'Machining Time Min';

  UPDATE calculator_fields SET default_value = '{Machining Time Min} * 60'
  WHERE calculator_id = v_calc_id AND field_name = 'Machining Time';

  UPDATE calculator_fields SET default_value = 'CEIL({Machining Time})'
  WHERE calculator_id = v_calc_id AND field_name = 'Time per Use';

  UPDATE calculator_fields SET default_value = '{No of Uses} * {Time per Use}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Time';

  UPDATE calculator_fields SET default_value = 'IF({Tool Life} > 0, {Tool Cost} / {Tool Life}, 0)'
  WHERE calculator_id = v_calc_id AND field_name = 'Tool Cost per Part';

  UPDATE calculator_fields SET default_value = '{MHR per Hour} * {Total Time} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value = '{LHR per Hour} * {Total Time} / (3600 * ({OLE} / 100))'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  UPDATE calculator_fields SET default_value = '{Machine Cost} + {Labour Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Process Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} * ({Setup Percentage} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} + {Setup Cost} + {Tool Cost per Part}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Process Cost';

  RAISE NOTICE 'Done — Machining Laser Cutting, ID: %', v_calc_id;
END $$;

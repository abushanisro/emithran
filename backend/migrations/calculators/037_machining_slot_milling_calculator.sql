-- ============================================================================
-- Calculator: Machining - Slot Milling
-- Category:   Process
-- Fields:     29 (8 W/C, 8 process, 13 calculated)
-- Same formula structure as Plunge Milling but uses user-input slot length
-- instead of the fixed 3.7×π×10 constant:
--   Machining Time = ((Length + 10 + Cutter Dia) / (Feed/tooth × No Teeth × RPM))
--                   × No of Passes × CEIL(Width / Cutter Dia)
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
    'Machining - Slot Milling',
    'process',
    'single',
    false,
    false,
    'Slot milling – cutter RPM, depth passes, width coverage, user-defined slot length, full cost breakdown'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',       'MHR/hour (INR/hr)',         'number', 'INR/hr',   NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',       'LHR/hour (INR/hr)',         'number', 'INR/hr',   NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                'OLE (%)',                   'number', '%',         NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',   'Setup Percentage (%)',      'number', '%',         NULL,  4, false, '30'),
    (v_calc_id, 'Tool Code',          'Tool Code',                 'text',   NULL,        NULL,  5, false, '0'),
    (v_calc_id, 'Tool Cost',          'Tool Cost (INR)',            'number', 'INR',       NULL,  6, false, '0'),
    (v_calc_id, 'Tool Life',          'Tool Life (Parts)',          'number', 'Parts',     NULL,  7, false, '0'),
    (v_calc_id, 'No of Uses',         'No. of Uses',               'number', NULL,        NULL,  8, false, '1'),

    (v_calc_id, 'Cutter Diameter',    'Cutter Diameter (mm)',      'number', 'mm',        NULL,  9, false, NULL),
    (v_calc_id, 'Length',             'Slot Length (mm)',          'number', 'mm',        NULL, 10, false, NULL),
    (v_calc_id, 'Width',              'Slot Width (mm)',           'number', 'mm',        NULL, 11, false, NULL),
    (v_calc_id, 'Total Depth',        'Total Depth of Cut (mm)',   'number', 'mm',        NULL, 12, false, NULL),
    (v_calc_id, 'Depth per Pass',     'Depth per Pass (mm)',       'number', 'mm',        NULL, 13, false, NULL),
    (v_calc_id, 'Cutting Speed',      'Cutting Speed (m/min)',     'number', 'm/min',     NULL, 14, false, NULL),
    (v_calc_id, 'Feed per Tooth',     'Feed/tooth (mm/tooth)',     'number', 'mm/tooth',  NULL, 15, false, NULL),
    (v_calc_id, 'No of Teeth',        'No. of Teeth',              'number', NULL,        NULL, 16, false, NULL),

    (v_calc_id, 'Spindle RPM',        'Spindle RPM',               'calculated', 'RPM',  NULL, 17, false, NULL),
    (v_calc_id, 'No of Passes',       'No. of Depth Passes',       'calculated', NULL,   NULL, 18, false, NULL),
    (v_calc_id, 'No of Width Passes', 'No. of Width Passes',       'calculated', NULL,   NULL, 19, false, NULL),
    (v_calc_id, 'Machining Time Min', 'Machining Time (min)',      'calculated', 'min',  NULL, 20, false, NULL),
    (v_calc_id, 'Machining Time',     'Machining Time (s)',        'calculated', 's',    NULL, 21, false, NULL),
    (v_calc_id, 'Time per Use',       'Time per Use (s)',          'calculated', 's',    NULL, 22, false, NULL),
    (v_calc_id, 'Total Time',         'Total Time (s)',            'calculated', 's',    NULL, 23, false, NULL),
    (v_calc_id, 'Tool Cost per Part', 'Tool Cost/Part (INR)',      'calculated', 'INR',  NULL, 24, false, NULL),
    (v_calc_id, 'Machine Cost',       'Machine Cost (INR)',        'calculated', 'INR',  NULL, 25, false, NULL),
    (v_calc_id, 'Labour Cost',        'Labour Cost (INR)',         'calculated', 'INR',  NULL, 26, false, NULL),
    (v_calc_id, 'Process Cost',       'Process Cost (INR)',        'calculated', 'INR',  NULL, 27, false, NULL),
    (v_calc_id, 'Setup Cost',         'Setup Cost (INR)',          'calculated', 'INR',  NULL, 28, false, NULL),
    (v_calc_id, 'Total Process Cost', 'Total Process Cost (INR)', 'calculated', 'INR',  NULL, 29, false, NULL);

  UPDATE calculator_fields SET default_value = '1000 * {Cutting Speed} / (3.14159265 * {Cutter Diameter})'
  WHERE calculator_id = v_calc_id AND field_name = 'Spindle RPM';

  UPDATE calculator_fields SET default_value = 'CEIL({Total Depth} / {Depth per Pass})'
  WHERE calculator_id = v_calc_id AND field_name = 'No of Passes';

  UPDATE calculator_fields SET default_value = 'CEIL({Width} / {Cutter Diameter})'
  WHERE calculator_id = v_calc_id AND field_name = 'No of Width Passes';

  UPDATE calculator_fields SET default_value = '(({Length} + 10 + {Cutter Diameter}) / ({Feed per Tooth} * {No of Teeth} * {Spindle RPM})) * {No of Passes} * {No of Width Passes}'
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

  RAISE NOTICE 'Done — Machining Slot Milling, ID: %', v_calc_id;
END $$;

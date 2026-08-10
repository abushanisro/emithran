-- ============================================================================
-- Calculator: Sheet Metal - Countersinking
-- Category:   Process
-- Replaces the flat sm_lookup_countersink per-diameter cycle_time_sec with
-- real rigid-drilling physics — same structure as migration 050
-- (Counterboring), 030 (Reaming), 038 (Tapping).
--
-- Real, sourced data (see default-rates.ts's resolveDrillingSpeedFeed/
-- COUNTERSINK_SPEED_FACTOR/HOLE_OP_* comments for full citations):
--   - Cutting Speed: same HSS drilling surface speed table as Counterboring,
--     x 0.25 — countersinking runs at 25% of the equivalent drill's speed,
--     same feed per rev (a direct, published tool-vendor design rule: Melin
--     Tool / MAFord / SuperTool countersink speed-feed sheets).
--   - Depth: real cone geometry, Depth = (Diameter/2) / tan(IncludedAngle/2)
--     — computed by the caller (bom-items.service.ts) from the real hole
--     diameter and a standard 90-degree included angle (no real angle is
--     CAD-extracted yet, disclosed as the one assumption; the geometry
--     itself is exact, not a guess).
--   - Approach/Retract/Tool Change: reuses the same disclosed overhead
--     values already established for Tapping/Counterboring.
--
-- Formulas: identical shape to Counterboring — Spindle RPM from cutting
-- speed/diameter, Machining Time from feed rate, Time per Use = Approach +
-- Machining + Retract, Total Time = No of Uses * Time per Use + Tool Change.
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
    'Sheet Metal - Countersinking',
    'process',
    'single',
    false,
    false,
    'Countersinking – real rigid-drilling physics at 25% of drill speed (published countersink design rule), replaces the flat per-diameter lookup'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',       'MHR/hour (INR/hr)',       'number', 'INR/hr', NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',       'LHR/hour (INR/hr)',       'number', 'INR/hr', NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                'OLE (%)',                 'number', '%',      NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',   'Setup Percentage (%)',    'number', '%',      NULL,  4, false, '30'),
    (v_calc_id, 'Tool Code',          'Tool Code',               'text',   NULL,     NULL,  5, false, '0'),
    (v_calc_id, 'Tool Cost',          'Tool Cost (INR)',          'number', 'INR',    NULL,  6, false, '0'),
    (v_calc_id, 'Tool Life',          'Tool Life (Parts)',        'number', 'Parts',  NULL,  7, false, '0'),
    (v_calc_id, 'No of Uses',         'No. of Uses',             'number', NULL,     NULL,  8, false, '1'),

    (v_calc_id, 'Diameter',           'Countersink Diameter (mm)', 'number', 'mm',     NULL,  9, false, NULL),
    (v_calc_id, 'Depth',              'Countersink Depth (mm)',    'number', 'mm',     NULL, 10, false, NULL),
    (v_calc_id, 'Cutting Speed',      'Cutting Speed (m/min)',     'number', 'm/min',  NULL, 11, false, NULL),
    (v_calc_id, 'Feed per Rev',       'Feed per Rev (mm/rev)',     'number', 'mm/rev', NULL, 12, false, NULL),

    (v_calc_id, 'Spindle RPM',        'Spindle RPM',             'calculated', 'RPM', NULL, 13, false, NULL),
    (v_calc_id, 'Machining Time Min', 'Machining Time (min)',    'calculated', 'min', NULL, 14, false, NULL),
    (v_calc_id, 'Machining Time',     'Machining Time (s)',      'calculated', 's',   NULL, 15, false, NULL),
    (v_calc_id, 'Approach Time',      'Approach Time (s)',       'calculated', 's',   NULL, 16, false, NULL),
    (v_calc_id, 'Retract Time',       'Retract Time (s)',        'calculated', 's',   NULL, 17, false, NULL),
    (v_calc_id, 'Tool Change Time',   'Tool Change Time (s)',    'calculated', 's',   NULL, 18, false, NULL),
    (v_calc_id, 'Time per Use',       'Time per Use (s)',        'calculated', 's',   NULL, 19, false, NULL),
    (v_calc_id, 'Total Time',         'Total Time (s)',          'calculated', 's',   NULL, 20, false, NULL),
    (v_calc_id, 'Tool Cost per Part', 'Tool Cost/Part (INR)',    'calculated', 'INR', NULL, 21, false, NULL),
    (v_calc_id, 'Machine Cost',       'Machine Cost (INR)',      'calculated', 'INR', NULL, 22, false, NULL),
    (v_calc_id, 'Labour Cost',        'Labour Cost (INR)',       'calculated', 'INR', NULL, 23, false, NULL),
    (v_calc_id, 'Process Cost',       'Process Cost (INR)',      'calculated', 'INR', NULL, 24, false, NULL),
    (v_calc_id, 'Setup Cost',         'Setup Cost (INR)',        'calculated', 'INR', NULL, 25, false, NULL),
    (v_calc_id, 'Total Process Cost', 'Total Process Cost (INR)','calculated', 'INR', NULL, 26, false, NULL);

  UPDATE calculator_fields SET default_value = '1000 * {Cutting Speed} / (3.14159265 * {Diameter})'
  WHERE calculator_id = v_calc_id AND field_name = 'Spindle RPM';

  UPDATE calculator_fields SET default_value = '{Depth} / ({Spindle RPM} * {Feed per Rev})'
  WHERE calculator_id = v_calc_id AND field_name = 'Machining Time Min';

  UPDATE calculator_fields SET default_value = '{Machining Time Min} * 60'
  WHERE calculator_id = v_calc_id AND field_name = 'Machining Time';

  UPDATE calculator_fields SET default_value = '1'
  WHERE calculator_id = v_calc_id AND field_name = 'Approach Time';

  UPDATE calculator_fields SET default_value = '1'
  WHERE calculator_id = v_calc_id AND field_name = 'Retract Time';

  UPDATE calculator_fields SET default_value = '3'
  WHERE calculator_id = v_calc_id AND field_name = 'Tool Change Time';

  UPDATE calculator_fields SET default_value = '{Approach Time} + {Machining Time} + {Retract Time}'
  WHERE calculator_id = v_calc_id AND field_name = 'Time per Use';

  UPDATE calculator_fields SET default_value = '({No of Uses} * {Time per Use}) + {Tool Change Time}'
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

  -- Link into process_calculator_mappings — the row for machine_class=
  -- 'drill_press', operation='Countersinking' (migration 381) has
  -- calculator_id NULL today (confirmed live; calculator_name is the
  -- descriptive-only 'Countersink Calculator', matching no real calculator).
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'drill_press'
    AND operation = 'Countersinking'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Sheet Metal Countersinking, ID: %', v_calc_id;
END $$;

-- ============================================================================
-- Calculator: Sheet Metal - Counterboring
-- Category:   Process
-- Replaces the flat sm_lookup_counterbore per-diameter cycle_time_sec with
-- real rigid-drilling physics — same structure as migrations 030 (Reaming)
-- and 038 (Tapping): Spindle RPM from cutting speed/diameter, machining time
-- from feed rate, approach/retract/tool-change overhead.
--
-- Real, sourced data (see default-rates.ts's DRILL_SURFACE_SPEED_M_MIN_BY_MATERIAL/
-- DRILL_FEED_MM_PER_REV/HOLE_OP_* comments for full citations):
--   - Cutting Speed: HSS drilling surface speed by material (AIMS Industrial /
--     Slugger Tool references, consistent with Machinery's Handbook ranges).
--   - Feed per Rev: standard HSS drilling/counterbore feed, 0.005-0.010 in/rev
--     midpoint (SuperTool Counterbore Feeds and Speeds spec sheet).
--   - Approach/Retract/Tool Change: reuses the same disclosed overhead values
--     already established for Tapping (same drill-press handling motions).
-- Depth is not yet CAD-extracted for counterbore holes — the caller passes a
-- disclosed fallback (sheet thickness) via resolveHoleOpPhysicsInputs(), the
-- same convention as Tapping's depth fallback.
--
-- Formulas:
--   Spindle RPM       = 1000 * Cutting Speed / (pi * Diameter)
--   Machining Time Min = Depth / (Spindle RPM * Feed per Rev)
--   Time per Use       = Approach Time + Machining Time + Retract Time
--   Total Time (single-group display) = No of Uses * Time per Use + Tool Change Time
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
    'Sheet Metal - Counterboring',
    'process',
    'single',
    false,
    false,
    'Counterboring – real rigid-drilling physics (RPM/feed/machining time), replaces the flat per-diameter lookup'
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

    (v_calc_id, 'Diameter',           'Counterbore Diameter (mm)', 'number', 'mm',     NULL,  9, false, NULL),
    (v_calc_id, 'Depth',              'Counterbore Depth (mm)',    'number', 'mm',     NULL, 10, false, NULL),
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
  -- 'drill_press', operation='Counterboring' (migration 381) has calculator_id
  -- NULL today (confirmed live). Link it now that a real calculator exists.
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'drill_press'
    AND operation = 'Counterboring'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Sheet Metal Counterboring, ID: %', v_calc_id;
END $$;

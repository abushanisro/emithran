-- ============================================================================
-- Calculator: Turning Cycle time Calculation
-- Category:   Process
-- Fields:     12 (8 Number, 4 Custom Formula)
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
    'Turning Cycle time Calculation',
    'process',
    'single',
    false,
    false,
    'CT for Turning Operation'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, display_order, is_required, default_value)
  VALUES
    -- Number (User Input)
    (v_calc_id, 'Workpiece Initial dia',  'Workpiece Initial dia',  'number',     'mm',     1,  false, NULL),
    (v_calc_id, 'Workpiece Final dia',    'Workpiece Final dia',    'number',     'mm',     2,  false, NULL),
    (v_calc_id, 'Length of Cut',          'Length of Cut',          'number',     'mm',     3,  false, NULL),
    (v_calc_id, 'Cutting Speed',          'Cutting Speed',          'number',     'm/min',  4,  false, NULL),
    (v_calc_id, 'Feed per revolution',    'Feed per revolution',    'number',     'mm/Rev', 5,  false, NULL),
    (v_calc_id, 'Depth of cut',           'Depth of cut',           'number',     'mm',     6,  false, NULL),
    (v_calc_id, 'Tool Travel Time',       'Tool Travel Time',       'number',     'Min',    9,  false, NULL),
    (v_calc_id, 'Max Length',             'Max Length',             'number',     'mm',    10,  false, NULL),

    -- Custom Formula
    (v_calc_id, 'Spindle RPM',            'Spindle RPM',            'calculated', NULL,     7,  false, '(1000*{Cutting Speed})/(PI*{Workpiece Initial dia})'),
    (v_calc_id, 'No. of passes',          'No. of passes',          'calculated', 'Nos',    8,  false, '(({Workpiece Initial dia}-{Workpiece Final dia})/2)/{Depth of cut}'),
    (v_calc_id, 'Machining Time',         'Machining Time',         'calculated', 'Min',   11,  false, '((({Length of Cut})+({Length of Cut}*10%))/({Feed per revolution}*{Spindle RPM}))*{No. of passes}+{Tool Travel Time}'),
    (v_calc_id, 'Total Cycle Time',       'Total Cycle Time',       'calculated', 'Sec',   12,  false, '{Machining Time}*60');

  RAISE NOTICE 'Done — Turning Cycle time Calculation, ID: %', v_calc_id;
END $$;

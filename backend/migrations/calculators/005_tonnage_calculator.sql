-- ============================================================================
-- Calculator: Tonnage Calculator
-- Category:   Process
-- Fields:     12 (7 Number, 5 Custom Formula)
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
    'Tonnage Calculator',
    'process',
    'single',
    false,
    false,
    'Injection Molding Tonnage Recommendation'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, display_order, is_required, default_value)
  VALUES
    -- Number (User Input / constant)
    (v_calc_id, 'Number of cavities',                  'Number of cavities',                  'number',     'No.',       1,  false, NULL),
    (v_calc_id, 'Part projected area',                 'Part projected area',                 'number',     'mm2',       2,  false, NULL),
    (v_calc_id, 'Runner projected area',               'Runner projected area',               'number',     'mm2',       3,  false, NULL),
    (v_calc_id, 'Min wall thickness',                  'Min wall thickness',                  'number',     'mm',        4,  false, NULL),
    (v_calc_id, 'Max length of flow',                  'Max length of flow',                  'number',     'mm',        5,  false, NULL),
    (v_calc_id, 'Cavity pressure theoretical',         'Cavity pressure theoretical',         'number',     'bar',       7,  false, NULL),
    (v_calc_id, 'Viscosity grade (Material Flowability)', 'Viscosity grade (Material Flowability)', 'number', NULL,      8,  false, NULL),
    (v_calc_id, 'Saftey factor',                       'Saftey factor',                       'number',     NULL,       10,  false, '1.2'),

    -- Custom Formula
    (v_calc_id, 'Flow path/wall thickness Ratio',      'Flow path/wall thickness Ratio',      'calculated', NULL,        6,  false, '{Max length of flow}/{Min wall thickness}'),
    (v_calc_id, 'Cavity pressure actual',              'Cavity pressure actual',              'calculated', 'kg/cm2',    9,  false, '{Cavity pressure theoretical}*1.02*{Viscosity grade (Material Flowability)}'),
    (v_calc_id, 'Shot projected area',                 'Shot projected area',                 'calculated', 'mm2',      11,  false, '({Part projected area}+{Runner projected area})*Number of cavities'),
    (v_calc_id, 'Clamping tonnage',                    'Clamping tonnage',                    'calculated', 'Ton',      12,  false, '(Shot projected area/100)*(Cavity pressure actual/1000)*{Saftey factor}');

  RAISE NOTICE 'Done — Tonnage Calculator, ID: %', v_calc_id;
END $$;

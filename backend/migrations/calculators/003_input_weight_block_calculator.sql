-- ============================================================================
-- Calculator: Input Weight Calculator for Block
-- Category:   Material
-- Fields:     5 (3 Number, 1 User Input, 1 Custom Formula)
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
    'Input Weight Calculator for Block',
    'material',
    'single',
    false,
    false,
    'Input Weight Calculator for Block RM'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, display_order, is_required)
  VALUES
    (v_calc_id, 'Max Length', 'Max Length', 'number',     'mm',    1, false),
    (v_calc_id, 'Max Width',  'Max Width',  'number',     'mm',    2, false),
    (v_calc_id, 'Density',    'Density',    'number',     'g/cm3', 3, false),
    (v_calc_id, 'Max Height', 'Max Height', 'number',     'mm',    4, false),
    (v_calc_id, 'Weight',     'Weight',     'calculated', 'Kg',    5, false);

  -- Formula expression
  UPDATE calculator_fields
  SET default_value = '({Max Length}*{Max Width}*{Max Height}*{Density})/1000000'
  WHERE calculator_id = v_calc_id AND field_name = 'Weight';

  RAISE NOTICE 'Done — Input Weight Calculator for Block, ID: %', v_calc_id;
END $$;

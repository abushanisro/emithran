-- ============================================================================
-- Calculator: Injection Molding Cycle time Calculation
-- Category:   Process
-- Fields:     18 (9 User Input, 6 DB Lookup, 3 Custom Formula)
-- Run in:     Supabase SQL Editor
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_user_id UUID := '5572f34d-2f51-456e-a5d7-96f840128b50';
BEGIN
  INSERT INTO calculators (
    user_id, name, calc_category, calculator_type, is_template, is_public
  ) VALUES (
    v_user_id,
    'Injection Molding Cycle time Calculation',
    'process',
    'single',
    false,
    false
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required)
  VALUES
    -- User Input fields
    (v_calc_id, 'Injection Rate',                     'Injection Rate',                     'number',          'kg/hr',   NULL,            1,  false),
    (v_calc_id, 'Avg Wall thickness',                  'Avg Wall thickness',                  'number',          'mm',      NULL,            3,  false),
    (v_calc_id, 'Shot Weight',                         'Shot Weight',                         'number',          'Grams',   NULL,            5,  false),
    (v_calc_id, 'Cooling Time',                        'Cooling Time',                        'number',          'Sec',     NULL,           12,  false),
    (v_calc_id, 'Pressure Holding Time',               'Pressure Holding Time',               'number',          'Sec',     NULL,           13,  false),
    (v_calc_id, 'Slider or Lifter Mechanism',          'Slider or Lifter Mechanism',          'number',          'Sec',     NULL,           14,  false),
    (v_calc_id, 'Dry Cycle Time',                      'Dry Cycle Time',                      'number',          'Sec',     NULL,           15,  false),
    (v_calc_id, 'Ejection Time',                       'Ejection Time',                       'number',          'Sec',     NULL,           16,  false),
    (v_calc_id, 'Pick & Place/ Shot',                  'Pick & Place/ Shot',                  'number',          'Sec',     NULL,           17,  false),

    -- Database Lookup fields (Raw Materials)
    (v_calc_id, 'Co Efficient Of Thermal Cnductivity', 'Co Efficient Of Thermal Cnductivity', 'database_lookup', 'W/mC',   'raw_materials',  4,  false),
    (v_calc_id, 'Specific Heat',                       'Specific Heat',                       'database_lookup', 'J/gc',   'raw_materials',  6,  false),
    (v_calc_id, 'Melt Density',                        'Melt Density',                        'database_lookup', 'kg/mm3', 'raw_materials',  7,  false),
    (v_calc_id, 'Injection Temperature',               'Injection Temperature',               'database_lookup', 'c',      'raw_materials',  9,  false),
    (v_calc_id, 'Mold Temperature',                    'Mold Temperature',                    'database_lookup', 'C',      'raw_materials', 10,  false),
    (v_calc_id, 'Ejection Temperature',                'Ejection Temperature',                'database_lookup', 'C',      'raw_materials', 11,  false),

    -- Custom Formula fields
    (v_calc_id, 'Injection Time',      'Injection Time',      'calculated', 'Sec',     NULL,  2, false),
    (v_calc_id, 'Thermal Diffusivity', 'Thermal Diffusivity', 'calculated', 'mm^2/s',  NULL,  8, false),
    (v_calc_id, 'Total Cycle time',    'Total Cycle time',    'calculated', 'Sec',     NULL, 18, false);

  -- Formula expressions
  UPDATE calculator_fields
  SET default_value = '(({Shot Weight}/1000)/({Injection Rate}*60%))*3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Injection Time';

  UPDATE calculator_fields
  SET default_value = '{Co Efficient Of Thermal Cnductivity}/({Specific Heat}*{Melt Density}*10^3)'
  WHERE calculator_id = v_calc_id AND field_name = 'Thermal Diffusivity';

  UPDATE calculator_fields
  SET default_value = '{Injection Time}+{Cooling Time}+{Pressure Holding Time}+{Slider or Lifter Mechanism}+{Dry Cycle Time}+{Ejection Time}+{Pick & Place/ Shot}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Cycle time';

  RAISE NOTICE 'Done — Injection Molding Cycle time Calculation, ID: %', v_calc_id;
END $$;

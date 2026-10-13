-- ============================================================================
-- Migration 904: Turret Press (TPP) calculator computes its own cycle time
--
-- Why: the "Sheet Metal - TPP Manufacturing" calculator carried Cycle Time (sec)
-- as a blank number the engineer had to type, plus fields nothing reads
-- (Process Type, Machine Name, M/c Automation, # of Direct Labors, # of Skilled
-- Labors). The real cycle time was computed somewhere else (the engine), so the
-- calculator and the quote could disagree.
--
-- Now Cycle Time (sec) is a calculated field, filled from the part and the
-- selected machine, with the same formula the cost engine reads:
--   punching     Punch Count / (Punch Rate x Stroke Rate Factor) x 60
--   tool changes Tool Changes x Tool Change Time / Lot size
--   nibbling     Nibble Length / Nibble Speed x 60
-- Sources of each input (seeded by the cost engine, shown with its Why text):
--   Punch Count          CAD: punched holes
--   Punch Rate           machine punch rate (Countries data export, migration 902)
--   Stroke Rate Factor   Lookup Table 1 by machine tonnage and part complexity (902)
--   Tool Changes         CAD: distinct hole diameters
--   Tool Change Time     machine tool_change_time_s
--   Nibble Length        CAD: contour cut length
--   Nibble Speed         machine nibble rate x tool step (diameter - overlap)
--   Lot size             the batch size on the form
-- The calculator is matched by name, every copy of it.
-- ============================================================================

DO $$
DECLARE
  v_calc RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_calc IN SELECT id FROM calculators WHERE name = 'Sheet Metal - TPP Manufacturing' LOOP
    DELETE FROM calculator_fields
     WHERE calculator_id = v_calc.id
       AND field_name IN (
         'Process Type', 'Machine Name', 'M/c Automation', 'Direct Labors', 'Skilled Labors',
         'Cycle Time (sec)'
       );

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
    SELECT v_calc.id, f.field_name, f.display_label, f.field_type, f.unit, NULL, f.display_order, false, f.default_value
      FROM (VALUES
        ('Punch Count',              'Punched Holes (#)',            'number',     NULL,         7,  NULL),
        ('Punch Rate (hits/min)',    'Machine Punch Rate (hits/min)', 'number',    'hits/min',   8,  NULL),
        ('Stroke Rate Factor',       'Stroke Rate Factor',           'number',     NULL,         9,  NULL),
        ('Tool Changes',             'Tool Changes (#)',             'number',     NULL,         10, NULL),
        ('Tool Change Time (s)',     'Tool Change Time (s)',         'number',     's',          11, NULL),
        ('Nibble Length (mm)',       'Nibble Length (mm)',           'number',     'mm',         12, NULL),
        ('Nibble Speed (mm/min)',    'Nibble Speed (mm/min)',        'number',     'mm/min',     13, NULL),
        ('Cycle Time (sec)',         'Cycle Time (sec)',             'calculated', 'sec',        15,
          '({Punch Count} / ({Punch Rate (hits/min)} * {Stroke Rate Factor})) * 60 + ({Tool Changes} * {Tool Change Time (s)}) / {Lot size} + ({Nibble Length (mm)} / {Nibble Speed (mm/min)}) * 60')
      ) AS f(field_name, display_label, field_type, unit, display_order, default_value)
     WHERE NOT EXISTS (
       SELECT 1 FROM calculator_fields cf WHERE cf.calculator_id = v_calc.id AND cf.field_name = f.field_name
     );

    -- Order of the remaining fields: force check, cycle time inputs, cycle time, setup.
    UPDATE calculator_fields cf
       SET display_order = o.display_order
      FROM (VALUES
        ('Length Of Cut (mm)', 1), ('Thickness (mm)', 2), ('Shear Strength (Mpa)', 3),
        ('Theoretical Force (Ton)', 4), ('Recommended Force (Ton)', 5), ('Selected Tonnage (T)', 6),
        ('Lot size', 14), ('Total Sheet Loading Unloading (min)', 16), ('Setup Time (min/piece)', 17)
      ) AS o(field_name, display_order)
     WHERE cf.calculator_id = v_calc.id AND cf.field_name = o.field_name;

    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'no "Sheet Metal - TPP Manufacturing" calculator found';
  END IF;
  RAISE NOTICE 'TPP calculators updated: %', v_count;
END $$;

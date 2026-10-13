-- ============================================================================
-- Migration 905: Waterjet calculator computes its own cycle time from the part and machine
--
-- Why: the "Sheet Metal - Waterjet Cutting Manufacturing" calculator took Piercing Time Per Start
-- from a generic table and carried fields nothing reads (Process Type, Pump Power, Machine Name,
-- M/c Automation, # of Direct Labors, # of Skilled Labors). It also left out two real terms the
-- reference data defines for waterjet cutting: the lead-in and lead-out of every start, and the
-- acceleration and deceleration adjustment.
--
-- Now, with the same formula the cost engine reads:
--   Cutting Time (min)  = (Cutting Length + No Of Starts x 2 x Lead In Per Start) / Cutting Speed
--                         x Cut Time Adjustment Factor
--   Piercing Time (min) = Pierce Delay Per Start x No Of Starts / 60
--   Total Time (sec)    = (Cutting Time + Piercing Time) x 60
-- Sources of each input (seeded by the cost engine, shown with its Why text):
--   Cutting Length, No Of Starts   CAD: cut path length, pierce count
--   Lead In Per Start (mm)         sheet metal variable standardWaterjetCutLeadInAmount (5)
--   Cutting Speed (mm/min)         sm_lookup_waterjet_cut by material and thickness
--   Cut Time Adjustment Factor     sheet metal variable waterjetCutTimeAdjustmentFactor (1.4)
--   Pierce Delay Per Start (s)     the selected machine nozzle_delay_s (machine library)
--   Lot Size                       the batch size on the form
-- The calculator is matched by name, every copy of it.
-- ============================================================================

DO $$
DECLARE
  v_calc RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_calc IN SELECT id FROM calculators WHERE name = 'Sheet Metal - Waterjet Cutting Manufacturing' LOOP
    DELETE FROM calculator_fields
     WHERE calculator_id = v_calc.id
       AND field_name IN (
         'Process Type', 'Pump Power', 'Machine Name', 'Machine Automation',
         'Direct Labors', 'Skilled Labors', 'Piercing Time Per Start'
       );

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
    SELECT v_calc.id, f.field_name, f.display_label, 'number', f.unit, NULL, f.display_order, false, NULL
      FROM (VALUES
        ('Lead In Per Start',          'Lead-in and Lead-out Per Start (mm)', 'mm',  5),
        ('Cut Time Adjustment Factor', 'Cut Time Adjustment Factor',          NULL,  6),
        ('Pierce Delay Per Start',     'Pierce Delay Per Start (s)',          's',   7)
      ) AS f(field_name, display_label, unit, display_order)
     WHERE NOT EXISTS (
       SELECT 1 FROM calculator_fields cf WHERE cf.calculator_id = v_calc.id AND cf.field_name = f.field_name
     );

    UPDATE calculator_fields SET default_value =
      '(({Cutting Length} + {No Of Starts} * 2 * {Lead In Per Start}) / {Cutting Speed}) * {Cut Time Adjustment Factor}'
     WHERE calculator_id = v_calc.id AND field_name = 'Cutting Time';

    UPDATE calculator_fields SET default_value =
      '({Pierce Delay Per Start} * {No Of Starts}) / 60'
     WHERE calculator_id = v_calc.id AND field_name = 'Piercing Time';

    -- Order: cut inputs, pierce input, the calculated times, then the setup inputs.
    UPDATE calculator_fields cf
       SET display_order = o.display_order
      FROM (VALUES
        ('Cutting Length', 1), ('No Of Starts', 2), ('Cutting Speed', 3),
        ('Lead In Per Start', 4), ('Cut Time Adjustment Factor', 5), ('Pierce Delay Per Start', 6),
        ('Cutting Time', 7), ('Piercing Time', 8), ('Total Time', 9),
        ('Sheet Loading Time', 10), ('Lot Size', 11), ('Setup Time', 12)
      ) AS o(field_name, display_order)
     WHERE cf.calculator_id = v_calc.id AND cf.field_name = o.field_name;

    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'no "Sheet Metal - Waterjet Cutting Manufacturing" calculator found';
  END IF;
  RAISE NOTICE 'Waterjet calculators updated: %', v_count;
END $$;

-- ============================================================================
-- Migration 896: Deslag calculator = burr edge length x machine time per mm
--
-- Why: the "Sheet Metal - Deburring" calculator (the Deslag line) priced
-- deburr like a laser cut: Length Of Cut / 1000 x 60 s/m + No Of Starts
-- (pierces) x 0.5 s. Both constants came from a web estimate (migration 413),
-- not from memory/, and pierce count has nothing to do with removing a burr.
--
-- Now: Total Time = Burr Edge Length x Deburr Time Per mm, where
--   Burr Edge Length   = the part cut length (the burr / slag sits on the cut
--                        edge), from CAD feature extraction
--   Deburr Time Per mm = the SELECTED machine own rate:
--     Deslag machine -> perimeter_allowance_s_per_mm (machine library,
--                       memory/Sheetmetal/machine/machine_library.csv)
--     Manual Deburr  -> passes / tblDeburring linear speed for the material
--                       (memory/Machining/lookup/tblDeburring, variables)
-- physics_key stays 'deburring'; the physics function computes the same
-- product. The calculator is matched by name, every copy of it.
-- ============================================================================

DO $$
DECLARE
  v_calc RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_calc IN SELECT id FROM calculators WHERE name = 'Sheet Metal - Deburring' LOOP
    DELETE FROM calculator_fields
     WHERE calculator_id = v_calc.id
       AND field_name IN ('Length Of Cut (mm)', 'No Of Starts', 'Sec Per Metre', 'Sec Per Pierce');

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
    SELECT v_calc.id, f.field_name, f.display_label, 'number', f.unit, NULL, f.display_order, false, NULL
      FROM (VALUES
        ('Burr Edge Length',   'Burr Edge Length (mm)',          'mm',   4),
        ('Deburr Time Per mm', 'Deburr Time Per mm (s/mm)',      's/mm', 5)
      ) AS f(field_name, display_label, unit, display_order)
     WHERE NOT EXISTS (
       SELECT 1 FROM calculator_fields cf WHERE cf.calculator_id = v_calc.id AND cf.field_name = f.field_name
     );

    UPDATE calculator_fields
       SET default_value = '{Burr Edge Length} * {Deburr Time Per mm}'
     WHERE calculator_id = v_calc.id AND field_name = 'Total Time';

    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Deslag calculators updated to the burr edge formula: %', v_count;
END $$;

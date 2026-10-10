-- ============================================================================
-- Migration 895: laser bed size (max_x_mm x max_y_mm) from the machine library
--
-- Why: laser machine selection checks that the flat part fits the machine bed,
-- but no fiber_laser (127 rows) or co2_laser (120 rows) mhr_records row has a
-- bed size, so the check never ran and a part of any size was "capable".
-- The selector now rejects a laser whose bed is unknown whenever other lasers
-- in its class have one, so this backfill is what lets real lasers be picked.
--
-- Source: memory/Sheetmetal/machine/machine_library.csv, categories
-- "Fiber Laser Cutting Machine" (26) and "Laser Cutting Machine" (24),
-- columns bed_length_mm / bed_width_mm. Every live row matches a library
-- name (checked 2026-10-08), across all five locations.
--
-- Only NULL columns are written; a value already on a row is never
-- overwritten. Names match case-insensitively with punctuation removed.
-- ============================================================================

DO $$
DECLARE
  v_updated INTEGER;
BEGIN
  WITH lib(machine_class, name, bed_length_mm, bed_width_mm) AS (
    VALUES
      ('fiber_laser', 'Amada ENSIS-3015 AJ 6kW Fiber',                  3070.0,  1550.0),
      ('fiber_laser', 'Amada ENSIS-4020 AJ 6kW Fiber',                  4070.0,  2050.0),
      ('fiber_laser', 'Amada FOL-3015 AJ 4kW Fiber',                    3070.0,  1550.0),
      ('fiber_laser', 'Amada LCG-3015 AJ 6kW Fiber',                    3070.0,  1550.0),
      ('fiber_laser', 'Bystronic BySprint 4020 3kW Fiber',              4064.0,  2024.0),
      ('fiber_laser', 'Bystronic BySprint 4020 6kW Fiber',              4064.0,  2024.0),
      ('fiber_laser', 'Bystronic BySprint 6520 6kW Fiber',              6614.0,  2024.0),
      ('fiber_laser', 'Bystronic Bystar 3015 10kW Fiber',               3100.0,  1580.0),
      ('fiber_laser', 'Durma HD-F 3015 10kW Fiber',                     3060.0,  1530.0),
      ('fiber_laser', 'Durma HD-F 3015 4kW Fiber',                      3060.0,  1530.0),
      ('fiber_laser', 'Durma HD-F 3015 6kW Fiber',                      3060.0,  1530.0),
      ('fiber_laser', 'Durma HD-F 3015 8kW Fiber',                      3060.0,  1530.0),
      ('fiber_laser', 'Laser Cutter - 10kW Fiber',                      3060.0,  1530.0),
      ('fiber_laser', 'Laser Cutter - 3kW Fiber',                       3060.0,  1530.0),
      ('fiber_laser', 'Laser Cutter - 4kW Fiber',                       3060.0,  1530.0),
      ('fiber_laser', 'Laser Cutter - 6kW Fiber',                       3060.0,  1530.0),
      ('fiber_laser', 'Laser Cutter - 8kW Fiber',                       3060.0,  1530.0),
      ('fiber_laser', 'Mitsubishi 800 Series 3015 eX-F10 10kW Fiber',   3050.0,  1525.0),
      ('fiber_laser', 'Mitsubishi 800 Series 3015 eX-F8 8kW Fiber',     3050.0,  1525.0),
      ('fiber_laser', 'Mitsubishi 800 Series 3015 eXZ-F60 6kW Fiber',   3050.0,  1525.0),
      ('fiber_laser', 'Mitsubishi ML 3015 sR-F30 3kW Fiber',            4064.0,  1524.0),
      ('fiber_laser', 'Salvagnini L3-30 2kW Fiber',                     3050.0,  1525.0),
      ('fiber_laser', 'Salvagnini L3-40 3kW Fiber',                     3048.0,  1524.0),
      ('fiber_laser', 'Trumpf TruLaser 1030 TruDisk 3001 3kW Fiber',    4064.0,  1524.0),
      ('fiber_laser', 'Trumpf TruLaser 3030 6kW Fiber',                 3050.0,  1525.0),
      ('fiber_laser', 'Trumpf TruLaser 5030 10kW Fiber',                3050.0,  1525.0),
      ('co2_laser', 'Cincinnati CL 850',                              3048.0,  1524.0),
      ('co2_laser', 'Default Laser',                                  6096.0,  3048.0),
      ('co2_laser', 'ESAB - 3000XT',                                  2048.0,  1524.0),
      ('co2_laser', 'Echo 3300',                                      4876.0,  2438.0),
      ('co2_laser', 'FO-MII 2412 NT',                                 2520.0,  1550.0),
      ('co2_laser', 'FO-MII 3015 NT',                                 3070.0,  1550.0),
      ('co2_laser', 'FO-MII RI 3015',                                 3070.0,  1270.0),
      ('co2_laser', 'LC-2412 F1 NT',                                  2520.0,  1150.0),
      ('co2_laser', 'LC-3015 F1 NT',                                  3070.0,  2050.0),
      ('co2_laser', 'LC-4020 F1 NT',                                  4070.0,  1550.0),
      ('co2_laser', 'LCG-3015',                                       3070.0,  2000.0),
      ('co2_laser', 'Laser Cutter - 10000 Watts',                     3000.0,  1500.0),
      ('co2_laser', 'Laser Cutter - 2000 Watts',                      3500.0,  1800.0),
      ('co2_laser', 'Laser Cutter - 3000 Watts',                      6000.0,  3000.0),
      ('co2_laser', 'Laser Cutter - 4000 Watts',                      4000.0,  2000.0),
      ('co2_laser', 'Laser Cutter - 6000 Watts',                      4000.0,  2000.0),
      ('co2_laser', 'Laser Cutter - 8000 Watts',                      3000.0,  1500.0),
      ('co2_laser', 'Mitsubishi NX 6000',                             4000.0,  1250.0),
      ('co2_laser', 'Quattro',                                        1250.0,  1250.0),
      ('co2_laser', 'Trumatic L 4030 - 4000',                         4000.0,  2000.0),
      ('co2_laser', 'Trumatic TLF 2700',                              6096.0,  3048.0),
      ('co2_laser', 'Trumatic TTLF 3200',                             4000.0,  2000.0),
      ('co2_laser', 'Trumpf True Laser 5030 - Truflow 10kW',          3000.0,  1500.0),
      ('co2_laser', 'Trumpf True Laser 5030 - Truflow 8kW',           3000.0,  1500.0)
  )
  UPDATE mhr_records m
     SET max_x_mm = COALESCE(m.max_x_mm, lib.bed_length_mm),
         max_y_mm = COALESCE(m.max_y_mm, lib.bed_width_mm)
    FROM lib
   WHERE m.machine_class = lib.machine_class
     AND regexp_replace(lower(m.machine_name), '[^a-z0-9]', '', 'g')
       = regexp_replace(lower(lib.name), '[^a-z0-9]', '', 'g')
     AND (m.max_x_mm IS NULL OR m.max_y_mm IS NULL);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'laser rows given a bed size from machine library: %', v_updated;
END $$;

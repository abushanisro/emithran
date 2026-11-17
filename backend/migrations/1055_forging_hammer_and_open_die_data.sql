-- ============================================================================
-- Migration 1055: forging data the new routes need: the hammer strain rate and the open die presses' force rating
-- ============================================================================
-- 1. forgingHammerStrainRate (variable, source version 2026-Forging): the strain rate a die hammer forges at, at which
--    the hammer's blow energy reads the material's flow stress. memory/Forging gives each material's hot flow law but no
--    strain rate. eMithran baseline: 100 per second, the order of a drop hammer's strain rate (10 to a few hundred per
--    second), the hammer's counterpart of forgingStrainRate (migration 1052).
--
-- 2. press_force_kn (spec of each forging_open_die_press machine, USA and India rows): the press's rated force. The
--    machine file (memory/Forging/Machine/forging_machines_openDiePress.csv) gives no force column; the rating is in each
--    machine's name ("1250T Press", "1000 Ton"), so no press could be checked against the force an upset needs. Read from
--    the names: the ERIE press (a US maker) in US tons of 2,000 lbf (8.896 kN), the others in metric tonnes-force
--    (9.807 kN).
--
-- Idempotent: the variable is inserted once and never overwritten; the spec is set only where the row has none.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw)
VALUES ('variable', 'USA', '2026-Forging', 'forgingHammerStrainRate', '100', '1/Time',
  'eMithran baseline: the strain rate of forging on a die hammer, at which the material flow stress is read for the hammer blow energy.',
  '{"Variable Name": "forgingHammerStrainRate", "String Value": 100, "Unit Type Name": "1/Time", "Notes": "eMithran baseline: the strain rate of forging on a die hammer, at which the material flow stress is read for the hammer blow energy."}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

UPDATE mhr_records m
SET specs = coalesce(m.specs, '{}'::jsonb) || jsonb_build_object('press_force_kn', v.force_kn)
FROM (VALUES
  ($str$ERIE Press Systems 3500 Ton Press$str$, 31137.6),
  ($str$Jinan Quanyue CNC Company 1250T Press$str$, 12258.3),
  ($str$Jinan Quanyue CNC Company 1600T Press$str$, 15690.6),
  ($str$Jinan Quanyue CNC Company 2000T Press$str$, 19613.3),
  ($str$Jinan Quanyue CNC Company 2500T Press$str$, 24516.6),
  ($str$Jinan Quanyue CNC Company 3150T Press$str$, 30890.9),
  ($str$Jinan Quanyue CNC Company 4000T Press$str$, 39226.6),
  ($str$Jinan Quanyue CNC Company 800T Press$str$, 7845.3),
  ($str$Open Die Press 1000 Ton$str$, 9806.6),
  ($str$Open Die Press 10000 Ton$str$, 98066.5),
  ($str$Open Die Press 20000 Ton$str$, 196133.0)
) AS v(machine_name, force_kn)
WHERE m.machine_class = 'forging_open_die_press'
  AND m.machine_name = v.machine_name
  AND NOT (coalesce(m.specs, '{}'::jsonb) ? 'press_force_kn');

NOTIFY pgrst, 'reload schema';

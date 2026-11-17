-- ============================================================================
-- Migration 1056: the rated force of the two open die presses migration 1055 missed
-- ============================================================================
-- Migration 1055 set press_force_kn on the forging_open_die_press machines from the rating in their names, and missed
-- "Open Die Press 3000 Ton" and "Open Die Press 5000 Ton" (memory/Forging/Machine/forging_machines_openDiePress.csv,
-- USA and India rows). Without a rating a press is never offered for an upset. Read as the file's other virtual presses
-- are (1000, 10000, 20000 Ton): metric tonnes-force of 9.80665 kN.
--
-- Idempotent: the spec is set only where the row has none.
-- ============================================================================

UPDATE mhr_records m
SET specs = coalesce(m.specs, '{}'::jsonb) || jsonb_build_object('press_force_kn', v.force_kn)
FROM (VALUES
  ($str$Open Die Press 3000 Ton$str$, 29420.0),
  ($str$Open Die Press 5000 Ton$str$, 49033.3)
) AS v(machine_name, force_kn)
WHERE m.machine_class = 'forging_open_die_press'
  AND m.machine_name = v.machine_name
  AND NOT (coalesce(m.specs, '{}'::jsonb) ? 'press_force_kn');

NOTIFY pgrst, 'reload schema';

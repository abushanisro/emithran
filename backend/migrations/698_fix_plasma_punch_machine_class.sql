-- ============================================================================
-- Migration 698: Fix machine_class for Plasma Punch (Machine Economics
-- backlog, Part 1)
-- ============================================================================
-- Same root cause as migration 697's Shear/Plasma Cut fix: the 12 real
-- Plasma Punch mhr_records rows (migration 584) have machine_class left
-- NULL, deliberately, at the time. classifyMachineRecord()'s Tier 0 fails
-- (NULL isn't a canonical value); Tiers 2/3 also fail for most of these real
-- names ("Whitney 4400 Max", "Muratec Magnium - 5000 Plasma", "Ficep Tipo
-- C23", "Ermak COP 1270 X 30" contain neither "plasma punch" nor a
-- MACHINE_REGISTRY.plasma_punch keyword) -- only the generically-named
-- "Plasma Punch - N Watts, N kN Press Force" rows would classify correctly
-- today. Confirmed: PlasmaPunchEngine (plasma-punch-engine.ts) is the real,
-- registered, tested cost engine expecting machine_class='plasma_punch'.
--
-- No capability-column backfill in this migration, deliberately: confirmed
-- via direct read of plasma-punch-engine.ts's own doc comment ("the only
-- real data available for this class is a feed-rate/pierce-time cutting
-- model... No punch-cycle data exists for this class anywhere in the
-- sourced reference data") and machine_library.json's own "Plasma Punch"
-- category fields (power_watts only -- no bed_length_mm/bed_width_mm/
-- press_force_kn/thickness field of any kind, unlike Shear or even Plasma
-- Cut's bed dimensions). A handful of machine NAMES embed a press-force
-- figure as free text ("Plasma Punch - 400 Watts, 1000kN Press Force") but
-- 8 of the 12 real machines have no such text and no real force data at
-- all -- inventing a MachineRequirement dimension with no real, systematic
-- per-machine backing would be exactly the fabrication this backlog is
-- avoiding. power_kw is backfilled (real, sourced, already-real data worth
-- having on file) even though it isn't gated on by isCapable() yet, same as
-- Plasma Cut.
-- ============================================================================

BEGIN;

UPDATE mhr_records
SET machine_class = 'plasma_punch'
WHERE benchmark_source_key LIKE 'Plasma Punch:%'
  AND machine_class IS NULL;

UPDATE mhr_records m
SET
  power_kw          = COALESCE(m.power_kw, ROUND((srd.raw->>'power_watts')::numeric / 1000, 3)),
  capability_source = COALESCE(m.capability_source, 'imported')
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Plasma Punch:%';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_name, machine_class, power_kw FROM mhr_records
--   WHERE benchmark_source_key LIKE 'Plasma Punch:%' ORDER BY machine_name;
-- -- Expect: machine_class='plasma_punch' and power_kw populated for all 12 rows.

-- ============================================================================
-- Migration 570: Backfill max_tonnage for the 281 machine_library-imported
-- mhr_records rows, via a direct join on benchmark_source_key
--
-- Context: unlike migrations 480/509/510/511 (which had to fuzzy/exact-name
-- match mhr_records rows against the machine_library export because the two
-- were separate, unlinked datasets at the time), this batch of 281 rows
-- (imported via the "clean Excel pipeline") already carries
-- benchmark_source_key = sm_reference_data.key for every row — an exact,
-- unambiguous 1:1 link, no name-matching needed at all.
--
-- A live query (2026-08-24) found max_tonnage NULL on all 281 of these rows
-- (0% backfilled), while 105 of them have a real press_force_kn in their
-- linked machine_library.json entry. Converting kN -> metric tonnes-force
-- (1 tonnage-force = 9.80665 kN, same SI conversion migrations 480/510
-- already used) is the exact same zero-guesswork transformation, just via a
-- direct join instead of literal per-machine values.
--
-- Scoped to machine_class IN ('press_brake', 'turret_punch') — the only two
-- classes whose capability check (machine-selection/selector.ts's
-- checkCapability) actually reads maxTonnage. Backfilling it for other
-- classes would be inert data with no real behavioural effect, so it's
-- deliberately left out of this migration (not a fabrication concern, just
-- not worth the write).
--
-- Explicitly NOT touched here: max_thickness_al_mm/ms_mm/ss_mm/cu_mm for
-- fiber_laser/co2_laser machines. Confirmed via code read
-- (machine-selection/selector.ts's laserThicknessLimit doc comment, already
-- flagged in CLAUDE.md's Sheet Metal readiness checklist) that the "Fiber
-- Laser Cutting Machine"/"3D Laser Cutting Machine" categories' thickness
-- data is shaped as unlabeled max_thickness_1_mm..max_thickness_5_mm tiers
-- with NO confirmed material-family legend — guessing MS/SS/AL/CU order onto
-- those tiers risks a wrong, confidently-labeled capability value, which is
-- worse than today's honest gap. "Bend Press Brake"/"Turret Press"/
-- "Progressive Die Press"/"Laser Punch / Punch Press" DO have plainly-named
-- max_thickness_aluminum_mm/steel_mm/stainless_steel_mm/copper_mm fields,
-- but press_brake/turret_punch's capability check only reads the generic
-- max_thickness_mm column, not per-material ones — so backfilling those
-- per-material columns for press-type machines would also be inert. Left
-- for a separate, deliberate follow-up once there's a real consumer.
-- ============================================================================

BEGIN;

UPDATE mhr_records m
SET max_tonnage = ROUND(((srd.raw->>'press_force_kn')::numeric / 9.80665)::numeric, 1)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND m.machine_class IN ('press_brake', 'turret_punch')
  AND m.max_tonnage IS NULL
  AND (srd.raw->>'press_force_kn') IS NOT NULL
  AND (srd.raw->>'press_force_kn')::numeric > 0;

COMMIT;

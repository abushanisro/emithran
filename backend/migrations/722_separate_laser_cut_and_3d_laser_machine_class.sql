-- ============================================================================
-- Migration 722: Separate 'Laser Cut' (generic) and '3D Laser' from
-- fiber_laser into their own real machine classes.
--
-- ROOT CAUSE
--
-- migration 369 (2026-07-22) assigned machine_class = 'fiber_laser' to THREE
-- distinct real process_calculator_mappings operations at once:
--
--   UPDATE process_calculator_mappings SET machine_class = 'fiber_laser'
--     WHERE ... operation IN ('Fiber Laser Cut','Laser Cut','3D Laser Cut')
--
-- migration 569 then propagated the same conflation into mhr_records,
-- COALESCEing the real "3D Laser Cutting Machine" reference category (15
-- machines) into machine_class = 'fiber_laser', and the real "Laser Cutting
-- Machine" reference category (24 machines) into machine_class = 'co2_laser'.
--
-- migration 715 (2026-09-09) separately deactivated "Fiber Laser Cut" as an
-- unused duplicate NAME of "Laser Cut" (both shared route/machine_class/
-- calculator, zero real usage under the "Fiber Laser Cut" name) — a real,
-- correct fix, but scoped only to that one duplicate-operation-name question.
-- It did not address, and does not conflict with, the separate question this
-- migration answers: whether the underlying MACHINE POOLS should share one
-- machine_class for rate/capability resolution.
--
-- CONFIRMED BY REAL DATA (memory/sheetmetal/machine/machine_library.json)
--
-- "Fiber Laser Cutting Machine" (26), "Laser Cutting Machine" (24) and
-- "3D Laser Cutting Machine" (15) are three real Digital Factory categories
-- with three DIFFERENT real capability schemas, not just different names:
--
--   Fiber Laser Cutting Machine: max_thickness_1_mm .. max_thickness_5_mm
--     (5 distinct real per-material-family thickness limits), e.g.
--     "Amada ENSIS-3015 AJ 6kW Fiber".
--   Laser Cutting Machine: no per-material thickness fields at all, e.g.
--     "Cincinnati CL 850".
--   3D Laser Cutting Machine: uniquely carries bed_height_mm (a real Z-axis
--     dimension, min 600mm / max 850mm across all 15) — the schema itself
--     confirms this is not a flat-sheet machine, e.g. "3D Laser - 3300 Watts".
--
-- Pooling three real, structurally different machine capability profiles
-- under one machine_class silently contaminates whichever class they're
-- forced into — the exact same shape of bug already fixed once for CO2
-- ("Quattro" tagged fiber_laser, see default-rates.constants.ts's co2_laser
-- MACHINE_REGISTRY comment) and once for Laser Punch/Turret Punch (127
-- mislabeled machines, CLAUDE.md 2026-09-01).
--
-- THE FIX
--
-- Give 'Laser Cut' (generic) and '3D Laser' their own real, distinct
-- machine_class values — 'laser_cut' and 'laser_3d' — on BOTH tables. The
-- 'Laser Cut' operation keeps its real, verified cutting-speed calculator
-- (migration 457/715, f8537846) unchanged — a calculator/formula choice,
-- independent of which machine pool prices against it.
--
-- Idempotent: every UPDATE below is scoped to the specific current
-- (wrong) machine_class value, so re-running this migration after it has
-- already succeeded is a no-op.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── 1. process_calculator_mappings: split the two operations ──────────────
UPDATE process_calculator_mappings
   SET machine_class = 'laser_cut',
       updated_at = NOW()
 WHERE process_group = 'Sheet Metal'
   AND process_route = 'Laser Cutting'
   AND operation = 'Laser Cut'
   AND machine_class = 'fiber_laser';

UPDATE process_calculator_mappings
   SET machine_class = 'laser_3d',
       updated_at = NOW()
 WHERE process_group = 'Sheet Metal'
   AND process_route = 'Laser Cutting'
   AND operation IN ('3D Laser', '3D Laser Cut')
   AND machine_class = 'fiber_laser';

-- ── 2. mhr_records: re-tag the real machine fleets to match ───────────────
-- "Laser Cutting Machine" (24 machines) was previously mapped to co2_laser
-- by migration 569's COALESCE (an unverified guess — real machine names in
-- this category, e.g. "Cincinnati CL 850", "Laser Cutter - 8000 Watts", show
-- no consistent CO2 evidence). Matches whatever value it currently holds
-- (co2_laser from 569, or fiber_laser if a later pass changed it) so this
-- step is safe to re-run regardless of which stale value is present.
UPDATE mhr_records
   SET machine_class = 'laser_cut'
 WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%'
   AND machine_class IN ('co2_laser', 'fiber_laser');

-- "3D Laser Cutting Machine" (15 machines) was previously COALESCEd into
-- fiber_laser by migration 569, contaminating the real flat-sheet fiber
-- laser fleet with 3D/tube-cutting machines that have a genuinely different
-- real capability schema (see header).
UPDATE mhr_records
   SET machine_class = 'laser_3d'
 WHERE benchmark_source_key LIKE '3D Laser Cutting Machine:%'
   AND machine_class = 'fiber_laser';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- 1. Exactly four distinct laser-related machine classes remain in active
--    use, none contaminated by another category's machines:
--
--   SELECT machine_class, COUNT(*) FROM mhr_records
--    WHERE benchmark_source_key LIKE 'Fiber Laser Cutting Machine:%'
--       OR benchmark_source_key LIKE 'Laser Cutting Machine:%'
--       OR benchmark_source_key LIKE '3D Laser Cutting Machine:%'
--    GROUP BY machine_class
--    ORDER BY machine_class;
--   -- Expect: fiber_laser ~26, laser_cut ~24, laser_3d ~15, and ZERO rows
--   -- from these three source keys tagged co2_laser.
--
-- 2. process_calculator_mappings reflects the split:
--
--   SELECT operation, process_route, machine_class, is_active
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation ILIKE '%laser%'
--    ORDER BY is_active DESC, operation;
--   -- Expect: 'Laser Cut' -> laser_cut, '3D Laser'/'3D Laser Cut' -> laser_3d,
--   -- 'Co2 Laser Cutting' -> co2_laser unchanged, 'Fiber Laser Cut' still
--   -- inactive (migration 715, untouched by this migration).
--
-- 3. No costing history was touched — this migration only ever updates
--    machine_class (plus updated_at on process_calculator_mappings):
--
--   SELECT COUNT(*) FROM process_cost_records WHERE operation IN ('Laser Cut', '3D Laser');

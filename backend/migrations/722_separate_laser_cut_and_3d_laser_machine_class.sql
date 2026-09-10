-- ============================================================================
-- Migration 722: Separate '3D Laser' from fiber_laser into its own real
-- machine class, and correctly route 'Laser Cut' (generic) to co2_laser.
-- ============================================================================
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
-- Machine" reference category (24 machines) into machine_class = 'co2_laser'
-- (this second COALESCE, it turns out below, actually landed on the RIGHT
-- class the whole time).
--
-- migration 715 (2026-09-09) separately deactivated "Fiber Laser Cut" as an
-- unused duplicate NAME of "Laser Cut" (both shared route/machine_class/
-- calculator, zero real usage under the "Fiber Laser Cut" name) — a real,
-- correct fix, but scoped only to that one duplicate-operation-name question.
-- It did not address, and does not conflict with, the separate question this
-- migration answers: whether the underlying MACHINE POOLS should share one
-- machine_class for rate/capability resolution.
--
-- CONFIRMED BY REAL DATA (memory/sheetmetal/machine/machine_library.json,
-- cross-checked against memory/sheetmetal/machine/india_base.json)
--
-- "Fiber Laser Cutting Machine" (26) and "3D Laser Cutting Machine" (15) are
-- real Digital Factory categories with real capability schemas distinct from
-- fiber_laser's assumptions:
--
--   Fiber Laser Cutting Machine: max_thickness_1_mm .. max_thickness_5_mm
--     (5 distinct real per-material-family thickness limits), e.g.
--     "Amada ENSIS-3015 AJ 6kW Fiber".
--   3D Laser Cutting Machine: uniquely carries bed_height_mm (a real Z-axis
--     dimension, min 600mm / max 850mm across all 15) — the schema itself
--     confirms this is not a flat-sheet machine, e.g. "3D Laser - 3300 Watts".
--
-- "Laser Cutting Machine" (24 machines, e.g. "Cincinnati CL 850", "Quattro")
-- was ORIGINALLY (same-day draft of this migration) also split into a new,
-- fourth class — 'laser_cut' — reasoning that its schema has no per-material
-- thickness fields at all, unlike Fiber Laser Cutting Machine's, so it
-- "must" be a distinct real pool. That reasoning was INCOMPLETE, caught by a
-- direct cross-file check before this migration was ever run:
-- memory/sheetmetal/machine/india_base.json independently names this exact
-- same 24-machine set "CO2 Laser Cutter" — confirmed name-for-name (only
-- OCR-level spelling differences, e.g. "FO-Mil" vs "FO-MII", "Trufow" vs
-- "Truflow"). "Quattro" itself — the one machine migration 456 had already,
-- separately, verified via AMADA's own official documentation as a genuine
-- CO2-architecture laser — is one of these same 24 machines. "Laser Cutting
-- Machine" IS the real CO2 laser fleet; machine_library.json just uses a
-- more generic label for the same category india_base.json names precisely.
-- There is no real fourth laser machine pool — only three (fiber, CO2,
-- 3D/tube) — so no new 'laser_cut' class is created here.
--
-- THE FIX
--
-- Give '3D Laser' its own real, distinct machine_class — 'laser_3d' — on
-- BOTH tables (unchanged from the original draft; this half was always
-- correct). Route the real 'Laser Cut' operation and the real "Laser Cutting
-- Machine" mhr_records fleet to the EXISTING 'co2_laser' class (where
-- "Quattro" already lived) instead of a new one. The 'Laser Cut' operation
-- keeps its real, verified cutting-speed calculator (migration 457/715,
-- f8537846) unchanged — a calculator/formula choice, independent of which
-- machine pool prices against it.
--
-- Idempotent: every UPDATE below is scoped to the specific current
-- (wrong) machine_class value, so re-running this migration after it has
-- already succeeded is a no-op.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── 1. process_calculator_mappings: route 'Laser Cut' to the real co2_laser
-- class, split '3D Laser'/'3D Laser Cut' into their own real class ─────────
UPDATE process_calculator_mappings
   SET machine_class = 'co2_laser',
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
-- "Laser Cutting Machine" (24 machines) was already mapped to co2_laser by
-- migration 569's COALESCE — that guess turned out to be RIGHT (confirmed
-- above via india_base.json). This UPDATE is a no-op if it's already
-- co2_laser; it only fixes the case where a later pass (this migration's own
-- earlier, unrun draft, or any other stale value) had moved it elsewhere.
UPDATE mhr_records
   SET machine_class = 'co2_laser'
 WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%'
   AND machine_class IN ('fiber_laser', 'laser_cut')
   AND machine_class IS DISTINCT FROM 'co2_laser';

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
-- 1. Exactly three distinct laser-related machine classes remain in active
--    use for these three source categories, none contaminated by another:
--
--   SELECT machine_class, COUNT(*) FROM mhr_records
--    WHERE benchmark_source_key LIKE 'Fiber Laser Cutting Machine:%'
--       OR benchmark_source_key LIKE 'Laser Cutting Machine:%'
--       OR benchmark_source_key LIKE '3D Laser Cutting Machine:%'
--    GROUP BY machine_class
--    ORDER BY machine_class;
--   -- Expect: fiber_laser ~26 (from Fiber Laser Cutting Machine only),
--   -- co2_laser ~24 (from Laser Cutting Machine, incl. "Quattro"),
--   -- laser_3d ~15 (from 3D Laser Cutting Machine), and ZERO rows tagged
--   -- 'laser_cut' (that class no longer exists).
--
-- 2. process_calculator_mappings reflects the fix:
--
--   SELECT operation, process_route, machine_class, is_active
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation ILIKE '%laser%'
--    ORDER BY is_active DESC, operation;
--   -- Expect: 'Laser Cut' -> co2_laser, '3D Laser'/'3D Laser Cut' -> laser_3d,
--   -- 'Co2 Laser Cutting' -> co2_laser (or NULL if still inactive, unchanged
--   -- by this migration either way — see its own is_active state),
--   -- 'Fiber Laser Cut' still inactive (migration 715, untouched here).
--
-- 3. No costing history was touched — this migration only ever updates
--    machine_class (plus updated_at on process_calculator_mappings):
--
--   SELECT COUNT(*) FROM process_cost_records WHERE operation IN ('Laser Cut', '3D Laser');

-- ============================================================================
-- Migration 700: Fix Roll Bending (2/3/4) machine_class mislabeling
-- (Machine Economics backlog, Part 1, final class)
-- ============================================================================
-- roll-bending-engine.ts's RollBendingEngine is a real, registered engine
-- with three distinct machine_class values: 'roll_bending_2',
-- 'roll_bending_3', 'roll_bending_4' (one shared cost formula, genuinely
-- distinct real machine pools: 4/25/19 machines, no name overlap). But
-- migrations 582 and 569 backfilled ALL THREE real categories'
-- mhr_records rows onto machine_class = 'roll_forming' instead --
-- colliding with 'roll_forming', a genuinely DIFFERENT, unrelated real
-- process (continuous-profile roll forming, its own sm_lookup_roll_forming
-- calculator table, migration 442) that happens to share a confusingly
-- similar name. Net effect (same defect class as migration 697/698's
-- Shear/Plasma Cut/Plasma Punch fixes): every 2/3/4 Roll Bender machine in
-- mhr_records was an unreachable phantom row for RollBendingEngine's own
-- selectMachine() lookups (wrong class = fetchMachinePool() never finds it),
-- silently falling back to the class-default benchmark rate/no-selection
-- path with zero real capability differentiation.
--
-- Scoped narrowly: only rows whose machine_class is CURRENTLY 'roll_forming'
-- AND whose benchmark_source_key real category prefix is one of the three
-- Roll Bender categories are touched -- any genuinely distinct real
-- roll_forming machine (if one is ever seeded) is untouched.
--
-- Real capability gating (RollBendingRequirement / MachineRequirement kind)
-- is deliberately NOT built in this migration -- see seed-registry.ts's own
-- roll_bending_2/_3/_4 comment: real per-category capability
-- (roll_working_length_mm, steel_thickness_mm) isn't modeled as a
-- MachineRequirement yet, the same already-accepted simplification as the
-- Standard/Tandem/Progressive-Die Press family. This migration only fixes
-- the class-identity bug so real machines are reachable/selectable at all;
-- capability-based ranking within the class remains a real, disclosed,
-- separate follow-up.
-- ============================================================================

BEGIN;

UPDATE mhr_records
SET machine_class = 'roll_bending_2'
WHERE machine_class = 'roll_forming'
  AND benchmark_source_key LIKE '2 Roll Bender:%';

UPDATE mhr_records
SET machine_class = 'roll_bending_3'
WHERE machine_class = 'roll_forming'
  AND benchmark_source_key LIKE '3 Roll Bender:%';

UPDATE mhr_records
SET machine_class = 'roll_bending_4'
WHERE machine_class = 'roll_forming'
  AND benchmark_source_key LIKE '4 Roll Bender:%';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_class, count(*) FROM mhr_records
--   WHERE benchmark_source_key LIKE '2 Roll Bender:%'
--      OR benchmark_source_key LIKE '3 Roll Bender:%'
--      OR benchmark_source_key LIKE '4 Roll Bender:%'
--   GROUP BY machine_class;
-- -- Expect roll_bending_2 (4 rows), roll_bending_3 (25 rows), roll_bending_4 (19 rows), no 'roll_forming' rows left among these keys.

-- Migration: separate the laser cutting operations, remove the duplicate
-- Description: Sheet Metal had THREE active laser catalog rows, two of which
--              were byte-identical in behaviour. Deactivates the unused
--              duplicate so exactly two distinct laser operations remain, on
--              two distinct machine classes. No operation is repointed and no
--              history is rewritten.
-- Date: 2026-09-09

-- THE STATE THIS FIXES
--
-- process_calculator_mappings, process_group = Sheet Metal:
--
--   ACTIVE  "Laser Cut"          route Laser Cutting  class fiber_laser  calc f8537846
--   ACTIVE  "Fiber Laser Cut"    route Laser Cutting  class fiber_laser  calc f8537846
--   ACTIVE  "Co2 Laser Cutting"  route Sheet Cutting  class co2_laser    calc NULL
--
-- The first two agree on route, machine_class AND calculator_id. They cannot
-- produce different costing behaviour -- they are one operation under two
-- names, which is why the Process screen shows what looks like two separate
-- laser processes that behave identically.
--
-- WHICH ONE IS REAL, DECIDED BY USAGE AND NOT BY NAME
--
-- process_cost_records, by operation name:
--
--   "Laser Cut"          71 rows, 6 active
--   "Fiber Laser Cut"     0 rows
--   "Co2 Laser Cutting"   0 rows
--
-- All 6 active "Laser Cut" rows carry machine_class = fiber_laser on a real
-- fiber machine (Salvagnini L3-30 Fiber). So in this deployment "Laser Cut" IS
-- the fiber-laser operation, backed by real applied quotes, and
-- "Fiber Laser Cut" is an unused synonym of it.
--
-- Deactivating the unused row is therefore the safe direction. The alternative
-- considered and rejected is recorded below, because the naming argues for it
-- and a future reader will reach for it.

BEGIN;

UPDATE process_calculator_mappings
   SET is_active = false,
       updated_at = NOW()
 WHERE process_group = 'Sheet Metal'
   AND operation = 'Fiber Laser Cut'
   AND process_route = 'Laser Cutting'
   AND machine_class = 'fiber_laser'
   AND is_active = true;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not repoint "Laser Cut" to co2_laser.
--
-- The naming convention on the machine side argues that it should: the wired
-- mhr_records rows map the machine category "Laser Cutting Machine" to
-- co2_laser and "Fiber Laser Cutting Machine" to fiber_laser, so an unqualified
-- "Laser" means CO2 there. The staged process taxonomy agrees, carrying
-- "Laser Cut" and "Fiber Laser Cut" as parallel families with their own
-- parallel operation sets (Laser Cutting / Laser Bevel Cutting versus Fiber
-- Laser Cutting / Fiber Laser Bevel Cutting).
--
-- Two facts override that argument here:
--
--   1. Real usage. 71 process_cost_records were costed under "Laser Cut", all
--      of the active ones on fiber_laser and a real fiber machine. The live
--      meaning of the name is fiber, whatever the taxonomy intended.
--
--   2. There is no CO2 cutting data to move it to. Migration 457 added the
--      laser_technology axis to sm_lookup_laser_cut and deliberately seeded
--      ZERO co2 rows, having found no published CO2 cutting-speed table that
--      met the sourcing bar. Repointing the one laser operation that real
--      routes use onto co2_laser would make it fail closed -- correct
--      behaviour for an unknown, but a regression for a working quote path.
--
-- So the taxonomy alignment stays open, and it is blocked on data rather than
-- on effort. Sourcing real CO2 cutting conditions unblocks BOTH that rename
-- and the sm-co2-laser route, which currently reports its gap honestly (see
-- the co2 gap wired into bom-items.service.ts) but can never be recommended.
--
-- Also left alone: "3D Laser" (route Laser Cutting, class fiber_laser,
-- calculator NULL, active). A NULL calculator_id is NOT disqualifying -- Std
-- Press, Tandem Press, OxyFuel Cut, Plasma Cut, Shearing, Laser Punch and
-- Plasma Punch all have one and all cost correctly through registered engines
-- -- and 3D laser cutting is a genuinely different operation from flat-sheet
-- laser cutting rather than a synonym of it.

-- Verification
--
-- 1. Exactly two active laser cutting operations remain, on two distinct
--    machine classes. Expected: "Laser Cut" (fiber_laser) and
--    "Co2 Laser Cutting" (co2_laser), plus "3D Laser" (fiber_laser).
--
--   SELECT operation, process_route, machine_class, is_active
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation ILIKE '%laser%'
--    ORDER BY is_active DESC, operation;
--
-- 2. No costing history was touched. Expected: 71 rows, 6 active, unchanged.
--
--   SELECT count(*) AS total, count(*) FILTER (WHERE is_active) AS active
--     FROM process_cost_records WHERE operation = 'Laser Cut';
--
-- 3. No active mapping lost its machine_class (chk_machine_class_required
--    still holds -- this migration only ever sets is_active = false).
--
--   SELECT count(*) FROM process_calculator_mappings
--    WHERE is_active = true AND machine_class IS NULL;

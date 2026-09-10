-- ============================================================================
-- Migration 728: Deactivate "Co2 Laser Cutting" — now a duplicate of
-- "Laser Cut", the same way "Fiber Laser Cut" was a duplicate of it before
-- migration 715.
-- ============================================================================
-- ROOT CAUSE
--
-- process_calculator_mappings, process_group = 'Sheet Metal', currently has
-- TWO active rows both resolving to the real co2_laser machine class:
--
--   ACTIVE  "Laser Cut"          route Laser Cutting  class co2_laser  calc f8537846
--   ACTIVE  "Co2 Laser Cutting"  route Sheet Cutting  class co2_laser  calc NULL
--
-- "Co2 Laser Cutting" has existed since migration 024 as a phantom row —
-- migration 418 already found it "no co2_laser engine exists" for at the
-- time, and migration 715 confirmed 0 real process_cost_records were ever
-- costed under it (versus 71 real rows under "Laser Cut"). It carries no
-- calculator_id and never has, so it can never itself produce a real cost —
-- it has only ever been a dead, duplicate-by-machine-class catalog entry.
--
-- Migration 715 (2026-09-09) already applied this exact reasoning once, to
-- deactivate "Fiber Laser Cut" for being a byte-identical duplicate of
-- "Laser Cut" (same route/machine_class/calculator). "Co2 Laser Cutting" was
-- deliberately left alone at that time because "Laser Cut" was still on
-- fiber_laser then — the two rows did NOT share a machine_class yet, so they
-- were not duplicates by that migration's own test.
--
-- Migration 722 (2026-09-10) repointed "Laser Cut" to co2_laser (the real
-- "Laser Cutting Machine" 24-machine Digital Factory pool — confirmed
-- name-for-name against memory/sheetmetal/machine/india_base.json's
-- "CO2 Laser Cutter" category). That repoint is what NOW makes "Co2 Laser
-- Cutting" a true duplicate of "Laser Cut" by the identical test migration
-- 715 already used: same real machine pool, same process family, only the
-- catalog operation name and process_route differ, and the duplicate has no
-- calculator behind it at all.
--
-- THE FIX
--
-- Deactivate "Co2 Laser Cutting". "Laser Cut" stays the one active, real,
-- costed identity for the co2_laser class — same direction as 715 (keep the
-- name real usage already lives under, drop the unused synonym), never the
-- reverse. Quattro's own machine_class ('co2_laser', migration 456 —
-- independently verified via AMADA's own official documentation, unrelated
-- to this catalog-operation question) is NOT touched here: this migration
-- retires a duplicate OPERATION NAME, not the real machine identity behind
-- it.
--
-- Also reverts process_taxonomy's own row for this operation back to its
-- original migration-609 seed values (machine_class=NULL,
-- roadmap_status='not_modeled'). Migration 725's Part A trigger only syncs
-- process_taxonomy FROM an is_active=true mapping row — it does not revert
-- on deactivation — so without this, process_taxonomy would keep reporting
-- 'Co2 Laser Cutting' as machine_class='co2_laser'/roadmap_status=
-- 'production' (725's own one-time backfill, taken while this row was still
-- active) even after the live operation behind it is retired here.
--
-- Idempotent: both statements are scoped to the exact current values each
-- targets; re-running after success is a no-op on both.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

UPDATE process_calculator_mappings
   SET is_active = false,
       updated_at = NOW()
 WHERE process_group = 'Sheet Metal'
   AND process_route = 'Sheet Cutting'
   AND operation = 'Co2 Laser Cutting'
   AND machine_class = 'co2_laser'
   AND is_active = true;

UPDATE process_taxonomy
   SET machine_class = NULL,
       roadmap_status = 'not_modeled'
 WHERE process_group = 'Sheet Metal'
   AND process_name = 'Co2 Laser Cutting'
   AND machine_class = 'co2_laser';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- 1. Every real laser machine class now has exactly one active identity row:
--
--   SELECT operation, process_route, machine_class, is_active, calculator_id
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation ILIKE '%laser%'
--    ORDER BY is_active DESC, operation;
--   -- Expect active rows: 'Fiber Laser Cut' (fiber_laser), 'Laser Cut'
--   -- (co2_laser), '3D Laser'/'3D Laser Cut' (laser_3d) -- each machine_class
--   -- on exactly one ACTIVE row. 'Co2 Laser Cutting' now inactive.
--
-- 2. process_taxonomy reverted to its pre-725 state for this row:
--
--   SELECT process_name, machine_class, roadmap_status FROM process_taxonomy
--    WHERE process_group = 'Sheet Metal' AND process_name = 'Co2 Laser Cutting';
--   -- Expect machine_class NULL, roadmap_status 'not_modeled'.
--
-- 3. No costing history was touched -- 0 rows, unaffected either way:
--
--   SELECT count(*) FROM process_cost_records WHERE operation = 'Co2 Laser Cutting';
--
-- 4. Route comparison for a real sheet-metal part still shows exactly the
--    three real laser routes (Fiber Laser, Laser Cut, 3D Laser), never a
--    fourth "Co2 Laser Cutting" entry.

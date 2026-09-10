-- ============================================================================
-- Migration 723: Reactivate "Fiber Laser Cut" — orphaned by migration 722's
-- co2_laser/laser_3d split.
--
-- ROOT CAUSE
--
-- Migration 715 (2026-09-09) deactivated "Fiber Laser Cut" because at that
-- time it was a byte-identical duplicate of "Laser Cut" — same route
-- ('Laser Cutting'), same machine_class ('fiber_laser'), same calculator
-- (f8537846). Real usage (71 process_cost_records) all lived under "Laser
-- Cut", so keeping that name active and deactivating the unused synonym was
-- the correct, safe call.
--
-- Migration 722 (2026-09-10) then repointed "Laser Cut" to machine_class =
-- 'co2_laser' (the real "Laser Cutting Machine"/"CO2 Laser Cutter" Digital
-- Factory pool — see that migration's own header). This correctly gave
-- co2_laser a real active identity row of its own, but it silently ORPHANED
-- fiber_laser: "Laser Cut" was the only active
-- process_calculator_mappings row ever tagged machine_class = 'fiber_laser',
-- and "Fiber Laser Cut" (the other one) was already deactivated. With no
-- active row left, resolveProcessIdentities() returns nothing for
-- fiber_laser, so getRouteComparison()'s `if (!identity || !rate) continue`
-- silently drops the Fiber Laser Cutting Machine route from comparison --
-- even though its real machine pool (127 mhr_records rows across 5
-- locations, confirmed live) is completely intact and untouched.
--
-- THE FIX
--
-- Reactivate "Fiber Laser Cut". This does not contradict migration 715: the
-- premise that made it "a duplicate to deactivate" (sharing machine_class
-- with "Laser Cut") no longer holds after migration 722 -- it is now the
-- ONE remaining, correct, non-duplicate identity for the real fiber_laser
-- machine pool, not a redundant synonym of anything.
--
-- Idempotent: scoped to the exact row migration 715 deactivated; re-running
-- after success is a no-op (WHERE is_active = false matches nothing).
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

UPDATE process_calculator_mappings
   SET is_active = true,
       updated_at = NOW()
 WHERE process_group = 'Sheet Metal'
   AND process_route = 'Laser Cutting'
   AND operation = 'Fiber Laser Cut'
   AND machine_class = 'fiber_laser'
   AND is_active = false;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification
--
-- 1. Every one of the three real laser machine classes now has exactly one
--    active identity row:
--
--   SELECT operation, process_route, machine_class, is_active, calculator_id
--     FROM process_calculator_mappings
--    WHERE process_group = 'Sheet Metal' AND operation ILIKE '%laser%'
--    ORDER BY is_active DESC, operation;
--   -- Expect active rows: 'Fiber Laser Cut' (fiber_laser), 'Laser Cut'
--   -- (co2_laser), '3D Laser' (laser_3d) -- each machine_class appearing on
--   -- exactly one ACTIVE row. 'Co2 Laser Cutting' (also co2_laser) should
--   -- stay whatever is_active state it already had — this migration does
--   -- not touch it, and 'Laser Cut' already carries co2_laser's one active
--   -- identity, so no orphaning risk exists for it either way.
--
-- 2. Re-run route comparison for a real sheet-metal part in the app (not a
--    cached view) and confirm "Fiber Laser + Press Brake" reappears
--    alongside "Laser Cut + Press Brake" (co2_laser) and "3D Laser + Press
--    Brake" -- three distinct laser routes, none dropped.

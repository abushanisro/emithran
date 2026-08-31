-- ============================================================================
-- Migration 605: Re-deactivate "Shearing"/"Shearning" (restore migration 388)
--
-- Root-caused 2026-08-30 from a live bug report: a saved "Shearning" process
-- step showed machine "Aida UMX-600" ($0.00 total cost, 0-sec cycle time) —
-- a Progressive Die Press machine, nothing to do with shearing OR bending.
--
-- Root cause, confirmed by direct migration history inspection:
--   1. Migration 388 (2026-07-31) deliberately deactivated BOTH "Shearing"
--      and "Shearning" (process_group='Sheet Metal', process_route=
--      'Sheet Cutting') because both map to machine_class='press_brake' with
--      NO distinct shearing cost-calculation path anywhere in this app —
--      selecting either silently produced a real Bend Brake cost line under
--      a shearing label. Migration 388's own header: "A genuine straight-
--      blade shear/guillotine operation, if ever needed, should get its own
--      machine_class and cost-engine formula distinct from bending — not
--      reuse this entry."
--   2. Migration 533 (2026-08-22), auditing ALL inactive Sheet Metal rows,
--      reactivated both — its own check only verified "does this row have a
--      real machine_class + calculator_id" (yes: press_brake, already wired
--      elsewhere) without re-examining why these two rows had been
--      deliberately turned off three weeks earlier. This silently undid
--      migration 388's fix.
--   3. Separately (same commit as this migration): default-rates.ts's
--      press_brake MACHINE_REGISTRY entry had an over-broad bare 'Press'
--      keyword, matching any machine_class containing the substring "press"
--      — including the entire, distinct Press/Forming family (Progressive
--      Die Press, Standard Press, Tandem Press, Turret Press). That keyword
--      is fixed in the same change as this migration (removed, keeping only
--      'Press Brake'/'Bend Brake'/'Bending Machine'). Combined with (1)+(2),
--      a genuinely unrelated Progressive Die Press machine (Aida UMX-600)
--      became a resolvable "press_brake" candidate and got selected for the
--      reactivated Shearning operation.
--
-- Fix: re-deactivate both rows, restoring migration 388's decision. Shearing
-- remains an explicit, documented gap (Track B Phase 2 — "Explicitly out of
-- scope, no dedicated cut-rate table found") — no real per-material shear-
-- rate data exists yet to build a genuine engine for it. A real, distinct
-- shearing machine_class + cost engine, when built later, is new work — not
-- something this migration invents.
-- ============================================================================

UPDATE process_calculator_mappings
SET is_active = false, updated_at = NOW()
WHERE process_group = 'Sheet Metal'
  AND process_route = 'Sheet Cutting'
  AND operation IN ('Shearing', 'Shearning');

-- Verification:
-- SELECT operation, process_route, is_active, machine_class FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation IN ('Shearing', 'Shearning');
-- Expect both is_active=false.

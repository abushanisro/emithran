-- ============================================================================
-- Migration 418: Give Waterjet and Turret Punch their own dedicated Sheet
-- Metal process_route, mirroring "Laser Cutting" — and retire the catch-all
-- "Sheet Cutting" route's dead/duplicate entries.
-- ============================================================================
-- Live catalog state (queried directly, not assumed from migration history)
-- before this migration, for process_group = 'Sheet Metal':
--
--   Route "Sheet Cutting" (11 rows) mixed real, phantom, and duplicate
--   entries together with no consistent structure:
--     Shearning         press_brake  is_active=false (already dead)
--     Fiber laser Cutting fiber_laser  calculator_id=NULL (phantom) — duplicate
--                                       of the real fiber_laser rows already
--                                       living cleanly under "Laser Cutting"
--     Co2 Laser Cutting  co2_laser    calculator_id=NULL (phantom) — AND no
--                                       ManufacturingProcessEngine is registered
--                                       for co2_laser at all (never a real
--                                       formula, just a machine_class label)
--     Plasma Cutting     plasma       calculator_id=NULL (phantom) — AND no
--                                       registered engine for plasma either
--     Water jet Cutting  waterjet     calculator_id=REAL (Sheet Metal -
--                                       Waterjet Cutting Manufacturing) — the
--                                       one entry that's actually fully real,
--                                       just stranded in the catch-all route
--     Blanking           press_brake  is_active=false (already dead)
--     3D Laser Cut       fiber_laser  calculator_id=NULL (phantom) — duplicate
--     Turret Press       turret_punch calculator_id=REAL (Sheet Metal - TPP
--                                       Manufacturing) — same situation as
--                                       waterjet: real, but stranded
--     Shearing           press_brake  is_active=false (already dead)
--     Waterjet Cutting   waterjet     calculator_id=REAL — EXACT duplicate of
--                                       "Water jet Cutting" above (same
--                                       calculator_id), just a second row
--     Nibbling           turret_punch calculator_id=NULL — no calculator at
--                                       all, redundant with Turret Press
--
--   Route "Bending/Floating /Forming" ALSO has its own separate "Turret
--   Press" row (calculator_id=REAL, same TPP calculator) plus a mislabeled
--   "Laser Puch" row (also mapped to the SAME turret_punch/TPP calculator —
--   a typo/mislabel, not a distinct laser-punch machine). Because
--   resolveProcessIdentities() picks the lowest-display_order ACTIVE row per
--   machine_class, "Laser Puch" (display_order 213) was actually WINNING
--   over every other turret_punch row (207, 214, 310) — meaning every
--   real turret-punch cost line in this app was being labeled with the
--   confusing, mislabeled operation name "Laser Puch" rather than anything
--   resembling "Turret Punch". This migration fixes that as a side effect of
--   consolidating onto one clean canonical row.
--
--   Route "Laser Cutting" (2 rows: "Laser Cut", "Fiber Laser Cut", both real,
--   same calculator) is untouched — it's already the clean pattern this
--   migration extends to waterjet and turret punch.
--
-- What this migration does:
--   1. Re-homes the one real waterjet row ("Water jet Cutting") into a new
--      "Waterjet Cutting" process_route, renamed to "Waterjet Cutting" for
--      naming consistency with its own calculator/route.
--   2. Re-homes the one real turret-punch row from "Sheet Cutting" ("Turret
--      Press") into a new "Turret Punch" process_route, renamed to "Turret
--      Punch" for clarity.
--   3. Deactivates every now-redundant duplicate (the second real waterjet
--      row, the Bending/Forming turret duplicates including the mislabeled
--      "Laser Puch", Nibbling) and every phantom entry with no real
--      calculator AND no registered cost engine (Co2 Laser Cutting, Plasma
--      Cutting) or that duplicates the already-clean Laser Cutting route
--      (Fiber laser Cutting, 3D Laser Cut).
--   4. After this, "Sheet Cutting" has zero active rows left — every real
--      cutting method (laser/waterjet/turret punch) now lives in its own
--      dedicated route, matching how Machining's own "Waterjet" route
--      already works. No code change needed elsewhere: resolveProcessIdentities
--      already resolves by machine_class + is_active, not by route name, so
--      the app functions identically — this migration only cleans up what
--      the admin Process page displays and which row wins ties.
-- ============================================================================

-- ── 1. Re-home the real waterjet row ───────────────────────────────────────
UPDATE process_calculator_mappings
SET process_route = 'Waterjet Cutting',
    operation = 'Waterjet Cutting',
    applicable_families = ARRAY['sheet_metal'],
    display_order = 300
WHERE id = '95075deb-59b8-4b79-88a3-e74defd7708f';  -- was: Sheet Cutting / Water jet Cutting

-- Deactivate the exact-duplicate second waterjet row (same calculator_id)
UPDATE process_calculator_mappings
SET is_active = false
WHERE id = 'd2b6ac62-c10e-4584-b55a-6e633cb47dd0';  -- Sheet Cutting / Waterjet Cutting (duplicate)

-- ── 2. Re-home the real turret-punch row ───────────────────────────────────
UPDATE process_calculator_mappings
SET process_route = 'Turret Punch',
    operation = 'Turret Punch',
    applicable_families = ARRAY['sheet_metal'],
    display_order = 301
WHERE id = '35bb5065-1baf-4857-83f0-338207412f61';  -- was: Sheet Cutting / Turret Press

-- Deactivate the redundant Bending/Forming duplicates, including the
-- mislabeled "Laser Puch" that was previously winning resolveProcessIdentities'
-- lowest-display_order tiebreak for every turret_punch cost line in the app.
UPDATE process_calculator_mappings
SET is_active = false
WHERE id IN (
  'fb775ffb-4d0c-4ead-9855-18150a8dc311',  -- Bending/Floating /Forming / Laser Puch (mislabeled)
  '4c212773-b941-4978-a311-9bc71666f70b',  -- Bending/Floating /Forming / Turret Press (duplicate)
  'dfbb14b0-fa2d-4267-a646-91dc384d9d4d'   -- Sheet Cutting / Nibbling (no calculator, redundant)
);

-- ── 3. Deactivate phantom/duplicate Sheet Cutting entries with no real
-- calculator AND no registered ManufacturingProcessEngine, or that duplicate
-- the already-clean Laser Cutting route ─────────────────────────────────────
UPDATE process_calculator_mappings
SET is_active = false
WHERE id IN (
  '7ee1fb69-ae38-4296-a28d-1a008cc1005c',  -- Sheet Cutting / Fiber laser Cutting (phantom, duplicates Laser Cutting route)
  '36c8f524-10d8-4863-88c5-8c87121fee55',  -- Sheet Cutting / Co2 Laser Cutting (phantom, no co2_laser engine exists)
  '7c2baa13-2197-458f-a327-d4658d9872fe',  -- Sheet Cutting / Plasma Cutting (phantom, no plasma engine exists)
  '263c2236-d28f-4276-81b8-94a827c76100'   -- Sheet Cutting / 3D Laser Cut (phantom, duplicates Laser Cutting route)
);

-- ── Verification ────────────────────────────────────────────────────────────
-- Every real, active Sheet Metal cutting method now has exactly one clean row:
-- SELECT process_route, operation, machine_class, calculator_id, is_active
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal'
--     AND process_route IN ('Sheet Cutting', 'Laser Cutting', 'Waterjet Cutting', 'Turret Punch')
--   ORDER BY process_route, display_order;
-- Expect: 0 active rows under "Sheet Cutting"; 2 under "Laser Cutting"
-- (Laser Cut, Fiber Laser Cut); 1 under "Waterjet Cutting"; 1 under "Turret Punch".

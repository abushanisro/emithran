-- ===================================================================================
-- Migration 388: Fix "Shearning"/"Shearing" mislabeled as bend operation (2026-07-31)
--
-- Bug report: a saved sheet-metal process line labeled "Shearning" displayed a
-- feature breakdown of "Bend R1 x2, Bend R2.5 x1" -- a real bending job shown
-- under a shearing label.
--
-- Root cause: process_calculator_mappings has two catalog rows under
-- process_group='Sheet Metal', process_route='Sheet Cutting' -- "Shearing"
-- (correct spelling) and "Shearning" (typo duplicate) -- both mapped by
-- migration 368 to machine_class='press_brake'. There is no distinct shearing
-- cost-calculation path anywhere in the engine (cost-engine.ts only has real
-- formulas for laser cutting and press-brake bending); the frontend matches a
-- saved row to a live engine line purely by machine_class
-- (manufacturing-intelligence/page.tsx's matchedEngineLine), so ANY row using
-- either of these two catalog entries is unconditionally matched to the
-- engine's real "Press Brake" bend-cost line and shows its bend breakdown --
-- regardless of the "Shearing"/"Shearning" label the user picked. Confirmed
-- DB-wide: exactly one saved process_cost_records row anywhere uses this
-- operation (id 34773446-44e7-4102-9f51-37cdab695f6d), so the blast radius of
-- a direct data fix is limited to that single row.
--
-- Fix:
--   1. Deactivate both misleading catalog entries (is_active=false) so the
--      operation dropdown no longer offers a "Shearing"/"Shearning" option
--      that silently produces bend-brake pricing. "Bend Brake" (already
--      seeded under process_route='Bending/Floating /Forming', same
--      machine_class='press_brake') is the correct, already-existing
--      catalog entry for this exact behavior -- reused rather than adding
--      yet another synonym.
--   2. Retroactively relabel the one existing saved row from
--      "Shearning"/"Sheet Cutting" to "Bend Brake"/"Bending/Floating
--      /Forming", matching the catalog entry it should have been all along.
--      machine_class is unchanged (was already correctly 'press_brake').
--
-- A genuine straight-blade shear/guillotine operation, if ever needed, should
-- get its own machine_class and cost-engine formula distinct from bending --
-- not reuse this entry.
-- ===================================================================================

UPDATE process_calculator_mappings
SET is_active = false
WHERE process_group = 'Sheet Metal'
  AND process_route = 'Sheet Cutting'
  AND operation IN ('Shearing', 'Shearning');

UPDATE process_cost_records
SET operation = 'Bend Brake',
    process_route = 'Bending/Floating /Forming'
WHERE operation = 'Shearning'
  AND machine_class = 'press_brake';

-- Verification:
-- SELECT operation, process_route, is_active FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation IN ('Shearing', 'Shearning', 'Bend Brake');
-- SELECT id, bom_item_id, operation, process_route, machine_class FROM process_cost_records
--   WHERE id = '34773446-44e7-4102-9f51-37cdab695f6d';

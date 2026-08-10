-- ===================================================================================
-- Migration 390: Fix "Blanking" recurrence of the mislabeled-bend-operation bug (2026-07-31)
--
-- Same exact bug as migration 388 ("Shearning"/"Shearing"), one catalog row
-- later: process_calculator_mappings has 'Blanking' under process_group=
-- 'Sheet Metal', process_route='Sheet Cutting', but mapped to machine_class=
-- 'press_brake' (migration 368). There is still no distinct blanking/cutting
-- cost-calculation path in cost-engine.ts -- only laser-cutting and press-
-- brake-bending formulas exist -- so any row using this catalog entry is
-- unconditionally matched (by machine_class alone) to the engine's real
-- "Press Brake" bend-cost line and shows its bend breakdown under a
-- "Blanking" label.
--
-- This specifically resurfaced because bom-items.service.ts's
-- resolveProcessIdentities() picks the ACTIVE machine_class='press_brake' row
-- with the LOWEST display_order as the default operation name for freshly
-- auto-created process rows (e.g. via "Apply Scenario"). 'Blanking'
-- (display_order=205) sorts before 'Bend Brake' (display_order=208), so once
-- 388 deactivated 'Shearing'/'Shearning', 'Blanking' became the next
-- lowest-display_order press_brake row and started winning instead.
--
-- Fix: same pattern as 388 -- deactivate 'Blanking' so it can no longer be
-- auto-picked for machine_class='press_brake', and relabel the one existing
-- saved row using it. 'Bend Brake' (process_route='Bending/Floating
-- /Forming', display_order=208) is the next-lowest active press_brake row
-- after this and the correct, already-existing entry for this behavior.
--
-- Root architectural note (not fixed here, out of scope for this bug report):
-- press_brake still has other Sheet-Cutting-route rows that could resurface
-- this same class of bug again (e.g. if 'Bend Brake' were ever deactivated).
-- The durable fix would be giving cutting/blanking/punching operations their
-- own machine_class distinct from bending, with a real cost formula --
-- deferred until that's actually needed.
-- ===================================================================================

UPDATE process_calculator_mappings
SET is_active = false
WHERE process_group = 'Sheet Metal'
  AND process_route = 'Sheet Cutting'
  AND operation = 'Blanking'
  AND machine_class = 'press_brake';

UPDATE process_cost_records
SET operation = 'Bend Brake',
    process_route = 'Bending/Floating /Forming',
    machine_class = 'press_brake'
WHERE operation = 'Blanking'
  AND (machine_class = 'press_brake' OR machine_class IS NULL);

-- Verification:
-- SELECT operation, process_route, is_active FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation IN ('Blanking', 'Bend Brake');
-- SELECT id, bom_item_id, operation, process_route, machine_class FROM process_cost_records
--   WHERE id = 'fa33ec0d-7344-4eec-aeef-8cebb9c73b34';

-- ============================================================================
-- Migration 634: Add Reaction Injection Molding to the process taxonomy +
-- calculator mappings
--
-- Confirmed missing entirely (not just from the Process page's UI list) —
-- Compression Molding, Injection Molding, and Structural foam molding all
-- have a process_taxonomy row + a process_calculator_mappings row; Reaction
-- Injection Molding has neither, despite:
--   - real machine data now staged for it (migration 633, 2 real machines)
--   - a real, already-built cost engine (cost-reaction-injection-molding-
--     engine.ts, Phase 1 materials-data work, 2026-09-02)
--   - real feature-type operations for it in
--     memory/Injection/process/digital_factory_operations.json
--   - a real default-machine reference in
--     memory/Injection/process/digital_factory_processes_and_rates.json
--     (Gusmer-Decker Reactor IP-40 — the same real machine now staged as a
--     real mhr_records row)
--
-- machine_class is left NULL here, matching the OTHER 3 Injection Molding
-- process_taxonomy rows (all NULL) — that column is not populated for any
-- row in this group; process_calculator_mappings.machine_class carries the
-- real value ('reaction_injection_molding') instead, same split the other
-- 3 processes already use.
--
-- roadmap_status = 'not_modeled' matches the OTHER 3 Injection Molding
-- rows' current (stale, disclosed-not-fixed-here) value — even "Injection
-- Molding" itself, a real live engine, still carries 'not_modeled'. Not
-- correcting that mislabel for any of the 4 rows in this migration — out
-- of scope for what was asked; flagged for a future pass.
-- ============================================================================

INSERT INTO process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, default_tool_shop_name, is_active, display_order)
VALUES ('Injection Molding', 'Reaction Injection Molding', NULL, 'not_modeled', 'Gusmer-Decker Reactor IP-40', 'Default', true, 0)
RETURNING id;

INSERT INTO process_calculator_mappings (process_group, process_route, operation, calculator_id, calculator_name, machine_class, is_active, display_order, canonical_process_id)
SELECT 'Injection Molding', 'Reaction Injection Molding', 'Reaction Injection Molding', NULL, 'Reaction Injection Molding Calculator', 'reaction_injection_molding', true, 3, id
FROM process_taxonomy
WHERE process_group = 'Injection Molding' AND process_name = 'Reaction Injection Molding';

NOTIFY pgrst, 'reload schema';

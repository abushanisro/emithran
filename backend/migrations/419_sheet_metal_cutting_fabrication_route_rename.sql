-- ============================================================================
-- Migration 419: Rename migration 418's routes to "Cutting" (waterjet) and
-- "Sheet Metal Fabrication" (turret punch), and add the real operation
-- variants of each — while keeping operations with no real cost formula
-- OUT of the active/costable set (added as disclosed, inactive placeholders
-- instead, same convention as Shearning/Blanking).
-- ============================================================================
-- Requested catalog shape:
--   Waterjet Cutting  -> Route "Cutting":     Waterjet Cutting, Abrasive
--                          Waterjet Cutting, Pure Waterjet Cutting (soft materials)
--   Turret Punch      -> Route "Sheet Metal Fabrication": Turret Punching,
--                          Hole Punching, Forming (Louvers, Embosses),
--                          Nibbling, Countersinking (if supported by tooling)
--
-- What's real vs. a placeholder, and why (checked against the actual
-- registered engines in manufacturing-process-registry.ts / cost-engine.ts,
-- not assumed):
--
--   Waterjet Cutting / Abrasive Waterjet Cutting: THE SAME real formula.
--   WaterjetEngine.computeCost (waterjet-engine.ts) already models abrasive
--   consumption unconditionally whenever there's cutting time — "abrasive
--   waterjet cutting" is not a distinct process from this app's point of
--   view, it's the same real calculator (Sheet Metal - Waterjet Cutting
--   Manufacturing) under a second, real-world-recognized name. Both rows are
--   mapped to the SAME calculator_id, active.
--
--   Pure Waterjet Cutting (for soft materials): NOT a formula this app has.
--   Pure (non-abrasive) waterjet is used on foam/rubber/gaskets/thin
--   plastics — materials this app doesn't cost at all (sheet_metal family is
--   metal-only; sm_lookup_waterjet_cut's material rows are Carbon Steel/
--   Stainless/Aluminium). Mapping this to the abrasive waterjet calculator
--   would silently charge abrasive cost for a process that by definition
--   uses none — exactly the fabricated-cost pattern this catalog cleanup
--   exists to prevent. Added as an INACTIVE, disclosed placeholder — visible
--   via the admin page's "Show inactive" toggle, not offered for costing
--   until a real non-abrasive formula + material scope exists for it.
--
--   Turret Punching / Hole Punching: THE SAME real formula. Both are the
--   real TurretPunchEngine punching-hits calculation (Sheet Metal - TPP
--   Manufacturing) under two real-world-recognized names. Both rows mapped
--   to the SAME calculator_id, active.
--
--   Nibbling: ALREADY a real part of TurretPunchEngine's formula (contour
--   cutting via cutLengthMm/nibble speed — see turret-punch-engine.ts) — it
--   was only ever inactive/uncalculated because its catalog row had no
--   calculator_id wired to it (a real gap, not a missing engine). Fixed here
--   by pointing it at the same real TPP calculator and reactivating it.
--
--   Forming (Louvers, Embosses): NOT a formula this app has. Louvers/
--   embosses use dedicated forming tooling with their own tonnage/cycle-time
--   physics, distinct from punching/nibbling — TurretPunchEngine has no
--   forming-tool model at all. Added as an INACTIVE, disclosed placeholder.
--
--   Countersinking (if supported by tooling): NOT a formula this app has for
--   TURRET presses specifically. This app already costs countersinking, but
--   only via the drill_press machine class / COUNTERSINK_SETUP_MIN + sm_
--   lookup_countersink (a completely different machine and formula — see
--   cost-engine.ts's Countersinking block). Mapping it to turret_punch here
--   would silently reuse an unrelated machine's rate/formula. Added as an
--   INACTIVE, disclosed placeholder — the user's own parenthetical "(if
--   supported by tooling)" already flags this as conditional/not-always-real,
--   which is exactly why it isn't switched on by default.
--
-- Code impact: bom-items.service.ts's disclosed-gap check (which flags real
-- catalog rows with no registered engine) is updated in the same commit to
-- check the new route names ('Cutting', 'Sheet Metal Fabrication') instead of
-- ('Waterjet Cutting', 'Turret Punch') — resolveProcessIdentities itself
-- matches by machine_class, not route name, so no other code depends on
-- these specific strings.
-- ============================================================================

-- ── Waterjet: rename route, add the real abrasive-variant name, add the
-- non-abrasive variant as a disclosed placeholder ──────────────────────────
UPDATE process_calculator_mappings
SET process_route = 'Cutting'
WHERE id = '95075deb-59b8-4b79-88a3-e74defd7708f';  -- Waterjet Cutting (real, active) — was route "Waterjet Cutting"

INSERT INTO process_calculator_mappings
  (process_group, process_route, operation, machine_class, calculator_id, calculator_name, is_active, display_order, applicable_families)
VALUES
  ('Sheet Metal', 'Cutting', 'Abrasive Waterjet Cutting', 'waterjet',
   '37a8bb8c-85fa-4ae0-8bf9-bf7f1b491e72', 'Sheet Metal - Waterjet Cutting Manufacturing',
   true, 302, ARRAY['sheet_metal']),
  ('Sheet Metal', 'Cutting', 'Pure Waterjet Cutting (for soft materials)', 'waterjet',
   NULL, NULL,
   false, 303, ARRAY['sheet_metal'])
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ── Turret punch: rename route + canonical operation, add the real
-- hole-punching-variant name, reactivate Nibbling onto the real calculator,
-- add Forming/Countersinking as disclosed placeholders ─────────────────────
UPDATE process_calculator_mappings
SET process_route = 'Sheet Metal Fabrication',
    operation = 'Turret Punching'
WHERE id = '35bb5065-1baf-4857-83f0-338207412f61';  -- was route "Turret Punch" / operation "Turret Punch"

UPDATE process_calculator_mappings
SET process_route = 'Sheet Metal Fabrication',
    calculator_id = 'a5d9b23a-5b8c-4d2b-98dd-3fa623458716',
    calculator_name = 'Turret Press Calculator',
    is_active = true,
    applicable_families = ARRAY['sheet_metal'],
    display_order = 305
WHERE id = 'dfbb14b0-fa2d-4267-a646-91dc384d9d4d';  -- Nibbling — real engine, was never wired to a calculator

INSERT INTO process_calculator_mappings
  (process_group, process_route, operation, machine_class, calculator_id, calculator_name, is_active, display_order, applicable_families)
VALUES
  ('Sheet Metal', 'Sheet Metal Fabrication', 'Hole Punching', 'turret_punch',
   'a5d9b23a-5b8c-4d2b-98dd-3fa623458716', 'Turret Press Calculator',
   true, 304, ARRAY['sheet_metal']),
  ('Sheet Metal', 'Sheet Metal Fabrication', 'Forming (Louvers, Embosses)', 'turret_punch',
   NULL, NULL,
   false, 306, ARRAY['sheet_metal']),
  ('Sheet Metal', 'Sheet Metal Fabrication', 'Countersinking (if supported by tooling)', 'turret_punch',
   NULL, NULL,
   false, 307, ARRAY['sheet_metal'])
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- ── Verification ────────────────────────────────────────────────────────────
-- SELECT process_route, operation, machine_class, calculator_id, is_active
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal'
--     AND process_route IN ('Cutting', 'Sheet Metal Fabrication')
--   ORDER BY process_route, display_order;
-- Expect: "Cutting" = 3 rows (2 active, 1 inactive placeholder);
-- "Sheet Metal Fabrication" = 5 rows (3 active, 2 inactive placeholders).

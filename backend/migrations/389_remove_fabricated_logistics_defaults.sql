-- ===================================================================================
-- Migration 389: Deactivate fabricated Packaging & Logistics default records (2026-07-31)
--
-- Root cause: manufacturing-intelligence/page.tsx's autoAddLogistics() silently
-- created THREE fabricated cost records for every BOM item, every time a
-- material grade was applied -- Inner Packaging $0.50/unit, Export Carton
-- $1.50/unit, Outbound Freight $3.00/kg. These numbers were never looked up
-- from any real supplier/freight rate; they were invented placeholder
-- constants, inserted as real, active, persisted cost records with no
-- indication to the user that they were fabricated rather than quoted.
--
-- This is the exact anti-pattern this project's standing engineering rule
-- forbids: no mocks/hardcoded/fallback data presented silently as real.
-- The frontend code that created these has been removed (autoAddLogistics()
-- and its STANDARD_LOGISTICS_TEMPLATES deleted); this migration cleans up the
-- records it already wrote. Procured Parts and Tooling already show a correct
-- empty "Add X" state when nothing real has been entered -- Packaging &
-- Logistics now behaves the same way instead of showing invented numbers.
--
-- Scoped tightly to the exact fabricated template (name + basis + unit_cost
-- all matching) so any genuinely different user-entered record is untouched.
-- Verified DB-wide before writing this: 13 active rows across 6 bom_items,
-- 100% match this exact template with zero ambiguous/partial matches.
-- Soft-delete (is_active = false) preserves the record for audit rather than
-- deleting it outright.
-- ===================================================================================

UPDATE packaging_logistics_cost_records
SET is_active = false
WHERE is_active = true
  AND (
    (cost_name = 'Inner Packaging'  AND logistics_type = 'packaging' AND cost_basis = 'per_unit' AND unit_cost = 0.5)
    OR (cost_name = 'Export Carton'   AND logistics_type = 'packaging' AND cost_basis = 'per_unit' AND unit_cost = 1.5)
    OR (cost_name = 'Outbound Freight' AND logistics_type = 'outbound'  AND cost_basis = 'per_kg'   AND unit_cost = 3.0)
  );

-- Verification:
-- SELECT bom_item_id, cost_name, unit_cost, is_active FROM packaging_logistics_cost_records
--   WHERE cost_name IN ('Inner Packaging', 'Export Carton', 'Outbound Freight');
-- Expect: all matching the fabricated template now is_active = false.

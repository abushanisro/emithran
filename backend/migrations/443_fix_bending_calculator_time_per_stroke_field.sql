-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 443: Restore the missing "Time Per Stroke" field on
-- "Sheet Metal - Bending Manufacturing" (2026-08-08)
--
-- Root cause, confirmed via a live SELECT on calculator_id
-- '102772ff-5422-45c1-b391-6d2d4a96ab1b': its 'Cycle Time' field's real,
-- live formula is
--   {Time Per Stroke} + ({Sheet Loading Time} * 60)
-- but NO field named 'Time Per Stroke' exists anywhere in this calculator's
-- 20 fields — only the formula references it. Migration 377 originally
-- named this input 'Stroke Time Per Bend' (lookup-fed from
-- sm_lookup_manual_stroke via data_source='sheet_metal_lookup',
-- source_field='manual_stroke') with the formula
-- `({Stroke Time Per Bend} * {No Of Bends}) + ({Sheet Loading Time} * 60)`.
-- At some point since (an interactive Calculator Builder edit, per this
-- session's own live editing of many Sheet Metal calculators), the field
-- was renamed/removed and the formula changed to reference the new name —
-- but the FIELD itself never got re-created, leaving a dangling formula
-- reference. This breaks Cycle Time for EVERY caller, not just the backend
-- cost engine — the standalone interactive dialog has the identical gap,
-- since {Time Per Stroke} can never resolve with no field to provide it.
--
-- Fix: re-add the missing input field under its current real name (matching
-- what the live formula already expects, rather than reverting the
-- formula), lookup-fed the same way 'Stroke Time Per Bend' originally was.
-- bom-items.service.ts's own seedScope key is updated in the same change to
-- match this real field name.
-- ════════════════════════════════════════════════════════════════════════════════

INSERT INTO calculator_fields
  (calculator_id, field_name, display_label, field_type, unit, data_source, source_field, display_order, is_required, default_value)
SELECT
  '102772ff-5422-45c1-b391-6d2d4a96ab1b', 'Time Per Stroke', 'Time Per Stroke (sec)', 'number', 'sec',
  'sheet_metal_lookup', 'manual_stroke', 21, false, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM calculator_fields
  WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b' AND field_name = 'Time Per Stroke'
);

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT field_name, field_type, data_source, source_field, default_value, display_order
-- FROM calculator_fields
-- WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
-- ORDER BY display_order;
-- Expect a 'Time Per Stroke' row now present, and Cycle Time's formula
-- ({Time Per Stroke} + ({Sheet Loading Time} * 60)) to evaluate once a real
-- 'Time Per Stroke' value is seeded (either interactively via the lookup, or
-- by bom-items.service.ts's real sm_lookup_manual_stroke resolution).

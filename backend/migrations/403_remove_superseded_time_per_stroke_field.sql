-- ============================================================================
-- Migration 403: Remove the superseded "Time Per Stroke" field on Sheet Metal
-- - Bending Manufacturing (calculator_id 102772ff-5422-45c1-b391-6d2d4a96ab1b).
--
-- Run AFTER migration 377. Context: migration 377 was written to fix the
-- exact bug live QA just found (Cycle Time = 5.8 sec from the calculator vs.
-- 39.0 sec saved) by adding a NEW field, "Stroke Time Per Bend", and
-- repointing the Cycle Time formula at it: ({Stroke Time Per Bend} *
-- {No Of Bends}) + ({Sheet Loading Time} * 60) -- correctly multiplying by
-- bend count, unlike migration 044's original formula ({Time Per Stroke} +
-- {Sheet Loading Time} * 60), which never did.
--
-- 377 never deleted the old "Time Per Stroke" field it superseded, and both
-- fields share the same data_source/source_field ('sheet_metal_lookup' /
-- 'manual_stroke'). The frontend's auto-populate (ProcessCostDialog.tsx's
-- handleExecuteCalculator two-pass lookup) finds the FIRST field matching
-- that source and stops there -- with "Time Per Stroke" still present and
-- ordered before "Stroke Time Per Bend" (display_order 21 vs 22), it would
-- keep getting the real lookup value while "Stroke Time Per Bend" -- the
-- field the formula actually reads -- stayed blank, breaking Cycle Time
-- outright. Removing the dead field removes the ambiguity: only one real
-- per-bend-stroke-time field exists, so the lookup can only resolve it.
-- ============================================================================

DELETE FROM calculator_fields
WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
  AND field_name = 'Time Per Stroke';

-- Verification:
-- SELECT field_name, field_type, data_source, source_field, default_value, display_order
--   FROM calculator_fields WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
--   ORDER BY display_order;
-- "Time Per Stroke" should be gone; "Stroke Time Per Bend" and the fixed
-- Cycle Time formula (from migration 377) should be the only ones left.

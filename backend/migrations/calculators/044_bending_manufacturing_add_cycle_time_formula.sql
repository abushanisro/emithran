-- ============================================================================
-- Calculator: Sheet Metal - Bending Manufacturing (calculator_id 102772ff-5422-45c1-b391-6d2d4a96ab1b)
--
-- Unlike the sibling "Sheet Metal - Laser Cutting Manufacturing" calculator,
-- this one's `Cycle Time` field was seeded (migration 009) as a plain manual
-- `number` input with no formula — every other time/cost field on this
-- calculator (Theoretical Force, Total Tonnage, Recommended Force, Setup
-- Time) IS a real `calculated` field. This left Bend Brake as the one process
-- whose interactive calculator dialog never showed a "Computed Cycle Time" /
-- "Use as Cycle Time" section the way Laser Cutting's does.
--
-- Adds the missing piece: a `Time Per Stroke` field sourced from the real
-- sm_lookup_manual_stroke table ("Lookup Table 4" in memory/sheetmetal/,
-- Thickness x Tonnage x Complexity -> seconds/stroke), using the SAME
-- data_source/source_field convention ('sheet_metal_lookup'/'manual_stroke')
-- ProcessCostDialog.tsx already recognizes and auto-resolves for this exact
-- lookup table (see its `SM_LOOKUP_DATA_SOURCE` handling) — not a new
-- mechanism. Then makes `Cycle Time` a real calculated field:
--   Cycle Time (sec) = Time Per Stroke + (Sheet Loading Time * 60)
-- exactly the Manual-mode formula documented in
-- memory/sheetmetal/Stamping_Bending_Calculator.md / Sheet_Metal_Calculators.md
-- for Bending (Time-per-stroke from Table 4 + sheet loading/unloading time,
-- converted from minutes to seconds).
--
-- Note (deferred, not resolved here): sm_lookup_manual_stroke has no data at
-- all for "Intermediate" complexity, which is the default complexity on
-- every part — when that lookup falls back, cost-engine.ts's existing
-- PRESS_BRAKE_SEC_PER_BEND hardcoded fallback (with its own warning) is used
-- exactly as it is today; this migration does not change that fallback path.
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID := '102772ff-5422-45c1-b391-6d2d4a96ab1b';
BEGIN
  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, source_field, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'Time Per Stroke', 'Time Per Stroke (sec)', 'number', 'sec', 'sheet_metal_lookup', 'manual_stroke', 21, false, NULL);

  UPDATE calculator_fields
  SET field_type = 'calculated',
      default_value = '{Time Per Stroke} + ({Sheet Loading Time} * 60)'
  WHERE calculator_id = v_calc_id AND field_name = 'Cycle Time';

  RAISE NOTICE 'Done — Bending Manufacturing Cycle Time formula added';
END $$;

-- Verification:
-- SELECT field_name, field_type, default_value, data_source, source_field, display_order
--   FROM calculator_fields WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
--   ORDER BY display_order;

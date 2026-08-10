-- ============================================================================
-- Migration 054: Reconcile Machining - Tapping calculator's Total Time with
-- the trusted cost-engine cycle time (2026-08-02)
--
-- After migration 053 added Approach/Retract/Tool-Change time, the
-- calculator's Total Time (9s for a 2-hole M3 tap at 1.5mm depth) still
-- didn't match the already-trusted, already-live cost-engine.ts value (7.7s,
-- the number shown in Direct Process Costs). Traced the exact deltas by
-- reading cost-engine.ts:597-649 and default-rates.ts's computeTapCycleSec:
--
--   1. TAP_UNLOAD_SEC (=2) is added ONCE PER OPERATION in cost-engine.ts:611,
--      outside the per-thread-group loop -- the calculator had no equivalent
--      field at all.
--   2. computeTapCycleSec's tapSec uses raw depthMm with no lead-in
--      allowance, while this calculator's pre-existing "Machining Time Min"
--      formula added "+4" to Length -- a real but different modelling choice
--      than the one the live cost engine actually uses.
--   3. cost-engine.ts's totalSec is never rounded mid-calculation (only
--      display-rounded to 2dp at the very end); this calculator's "Time per
--      Use" wrapped everything in CEIL(...), rounding up per hole before
--      multiplying by count -- compounding the mismatch.
--
-- Verified by hand for Tap Diameter=3, Length=1.5, Cutting Speed=10,
-- Feed/rev=0.5, count=2: cost-engine.ts's real computeTapCycleSec() output is
-- 7.68s. After this migration the calculator produces the same 7.68s for the
-- same inputs.
--
-- Scope note: this migration only touches the interactive calculator's own
-- fields (fe42139c-...) -- cost-engine.ts (the live, system-wide costing
-- path used for every BOM item's saved cost) is NOT touched. That's the
-- deliberately trusted reference this calculator is being reconciled TO, not
-- the other way around -- rewriting it would affect every tapped BOM item's
-- quoted cost, a much larger blast radius than fixing one calculator's field
-- chain to agree with it.
-- ============================================================================

-- Make room for "Unload Time" ahead of "Time per Use" (currently order 19).
UPDATE calculator_fields
SET display_order = display_order + 1
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf'
  AND display_order >= 19;

-- New field: Unload Time, once per operation (matches TAP_UNLOAD_SEC).
INSERT INTO calculator_fields
  (id, calculator_id, field_name, display_label, field_type, data_source, source_table, source_field,
   lookup_config, default_value, unit, min_value, max_value, is_required, validation_rules, input_config,
   display_order, field_group)
VALUES
  (gen_random_uuid(), 'fe42139c-5675-4a82-94d5-7f2d440ae9bf', 'Unload Time', 'Unload Time (s)', 'calculated',
   NULL, NULL, NULL, '{}', '2', 's', NULL, NULL, false, '{}', '{}', 19, NULL);

-- Machining Time Min: drop the "+4" lead-in allowance to match
-- computeTapCycleSec()'s raw-depth model.
UPDATE calculator_fields
SET default_value = '(3.14159265 * {Tap Diameter} * {Length}) / (1000 * {Cutting Speed} * {Feed per Rev})'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Machining Time Min';

-- Time per Use: drop CEIL -- cost-engine.ts never rounds mid-calculation.
UPDATE calculator_fields
SET default_value = '{Machining Time} + {Approach Time} + {Retract Time}'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Time per Use';

-- Total Time: add Unload Time once (matches totalSec + TAP_UNLOAD_SEC).
UPDATE calculator_fields
SET default_value = '{Tool Change Time} + {Unload Time} + ({No of Uses} * {Time per Use})'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Total Time';

-- Verification:
-- SELECT field_name, field_type, default_value, display_order FROM calculator_fields
--   WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' ORDER BY display_order;

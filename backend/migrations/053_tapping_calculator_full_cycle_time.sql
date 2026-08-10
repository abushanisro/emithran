-- ============================================================================
-- Migration 053: Add Approach/Retract/Tool-Change time to Machining - Tapping
-- calculator so its Total Time matches the trusted backend cycle-time model
-- (2026-08-02)
--
-- The interactive "Machining - Tapping" calculator (fe42139c-...) only ever
-- computed Total Time = No of Uses * CEIL(single-pass cutting time) -- no
-- approach, retract, or tool-change time anywhere in its field/formula chain
-- (confirmed by reading every field row: display_order 1-23, nothing else
-- references time). That's an 8x undercount versus the backend's already-
-- trusted computeTapCycleSec() (default-rates.ts), which explicitly adds:
--   - TAP_APPROACH_SEC = 1s   (spindle rapid-approach to the hole)
--   - retractSec = tapSec    (reverse-out takes the same time as tapping in)
--   - TAP_TOOL_CHANGE_SEC = 3s (once per operation, not per hole)
--
-- This migration adds the same three constants as new calculated fields and
-- wires them into Time per Use / Total Time, so the calculator's Total Time
-- reconciles with the Direct Process Costs panel's cycle time instead of
-- silently modelling cutting time only.
-- ============================================================================

-- Make room: shift every field at/after "Time per Use" (order 16) up by 3
-- to fit the 3 new fields ahead of it.
UPDATE calculator_fields
SET display_order = display_order + 3
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf'
  AND display_order >= 16;

-- New fields: Approach Time (constant), Retract Time (mirrors cut time),
-- Tool Change Time (constant, applied once via the Total Time formula below).
INSERT INTO calculator_fields
  (id, calculator_id, field_name, display_label, field_type, data_source, source_table, source_field,
   lookup_config, default_value, unit, min_value, max_value, is_required, validation_rules, input_config,
   display_order, field_group)
VALUES
  (gen_random_uuid(), 'fe42139c-5675-4a82-94d5-7f2d440ae9bf', 'Approach Time', 'Approach Time (s)', 'calculated',
   NULL, NULL, NULL, '{}', '1', 's', NULL, NULL, false, '{}', '{}', 16, NULL),
  (gen_random_uuid(), 'fe42139c-5675-4a82-94d5-7f2d440ae9bf', 'Retract Time', 'Retract Time (s)', 'calculated',
   NULL, NULL, NULL, '{}', '{Machining Time}', 's', NULL, NULL, false, '{}', '{}', 17, NULL),
  (gen_random_uuid(), 'fe42139c-5675-4a82-94d5-7f2d440ae9bf', 'Tool Change Time', 'Tool Change Time (s)', 'calculated',
   NULL, NULL, NULL, '{}', '3', 's', NULL, NULL, false, '{}', '{}', 18, NULL);

-- Time per Use now rounds up the full per-hole cycle (approach + cut +
-- retract), not just raw cutting time.
UPDATE calculator_fields
SET default_value = 'CEIL({Machining Time} + {Approach Time} + {Retract Time})'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Time per Use';

-- Total Time adds Tool Change Time once (not per hole), matching
-- computeTapCycleSec()'s toolChangeSec + perHoleSec * count structure.
UPDATE calculator_fields
SET default_value = '{Tool Change Time} + ({No of Uses} * {Time per Use})'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Total Time';

-- Verification:
-- SELECT field_name, field_type, default_value, display_order FROM calculator_fields
--   WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' ORDER BY display_order;

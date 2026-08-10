-- ============================================================================
-- Migration 050: "Skilled Labors" default_value inconsistency (2026-08-01)
--
-- Per memory/sheetmetal/Sheet_Metal_Calculators.md: "# of Skilled Labors ...
-- Look up value from the machine database; if no value in machine database
-- default value is 1." mhr_records has no per-machine skilled-labor headcount
-- column (only a single combined "operators" count) -- confirmed via schema
-- check -- so the "look up from machine database" branch can never resolve;
-- the fallback of 1 is the ONLY value that ever actually applies.
--
-- Currently inconsistent across calculators (some already "1", some "0")
-- with no functional reason for the difference. Field stays visible/editable
-- per user's explicit request -- this only fixes the default it starts at.
-- ============================================================================

UPDATE calculator_fields
SET default_value = '1'
WHERE field_name = 'Skilled Labors'
  AND default_value = '0';

-- Verification:
-- SELECT calculator_id, field_name, default_value FROM calculator_fields
--   WHERE field_name = 'Skilled Labors';
-- Expect: every row now shows default_value = '1'.

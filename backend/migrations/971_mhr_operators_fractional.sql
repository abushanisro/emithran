-- Migration 971: mhr_records.operators holds fractions of an operator
-- Date: 2026-11-07
--
-- The press data in memory/Plastic Modeling states `accounting.numberOfOperators` = 0.5 for all 81 injection and all 21 structural-foam presses (one
-- operator tends two presses). The column was smallint, so staging stored 1 and every labour charge on those presses was double the source.
--
-- Schema only (reference data may not be written by a migration after 935, see migrations/REFERENCE_DATA.json): the column becomes numeric(5,2).
-- Existing values are unchanged (an integer stays the same integer). The 102 presses are corrected by `backend/scripts/restage-machine-operators.cjs`,
-- which prints the UPDATE statements from the source CSVs for a person with access to run; until then nothing about them changes.
--
-- No view, function or constraint depends on the column (checked), so the type change needs no other statement.

ALTER TABLE mhr_records
  ALTER COLUMN operators TYPE numeric(5,2) USING operators::numeric(5,2);

COMMENT ON COLUMN mhr_records.operators IS 'Operators the machine is manned with (mhr_records / machine source numberOfOperators). Fractional: 0.5 is one operator for two machines. NULL when the source states none; callers use 1 then, never 0.';

NOTIFY pgrst, 'reload schema';

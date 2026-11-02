-- ============================================================================
-- Migration 953: should-cost calibration sets rates from a benchmark baseline
-- ============================================================================
-- Calibration (scripts/should-cost-calibrate.ts) used to multiply the CURRENT BENCHMARK rate of a cell, so every run built on the
-- last one's result and its rounding. Now each BENCHMARK mhr_records row keeps its uncalibrated value, and a run sets
--   total_machine_hour_rate = baseline_mhr × baseline_multiplier   (and mhr_usd_per_hour from baseline_mhr_usd_per_hour)
-- where baseline_multiplier is the cell's accumulated correction, recorded per run in rate_calibration_history and bounded to
-- [0.5, 2] (src/modules/should-cost/calibration.ts). Re-running gives the same rates; no number of runs moves a rate outside
-- those bounds of its benchmark.
--
-- The baselines are filled by the calibration run itself, the first time it touches a row (baseline = the rate at that moment,
-- in the same transaction that recalculates it): mhr_records holds eMithran reference rows, which migrations no longer write
-- (REFERENCE_DATA.json). Until a row is calibrated its rate IS its baseline, so an empty baseline_mhr means exactly that.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE public.mhr_records
  ADD COLUMN IF NOT EXISTS baseline_mhr numeric,
  ADD COLUMN IF NOT EXISTS baseline_mhr_usd_per_hour numeric;

COMMENT ON COLUMN public.mhr_records.baseline_mhr IS
  'BENCHMARK rows: total_machine_hour_rate before should-cost calibration (set by the first calibration of the row). Calibration sets total_machine_hour_rate = baseline_mhr x the cell''s baseline_multiplier. To change a calibrated benchmark rate, change this.';
COMMENT ON COLUMN public.mhr_records.baseline_mhr_usd_per_hour IS
  'BENCHMARK rows: mhr_usd_per_hour before should-cost calibration; see baseline_mhr.';

ALTER TABLE public.rate_calibration_history ADD COLUMN IF NOT EXISTS baseline_multiplier numeric;

COMMENT ON COLUMN public.rate_calibration_history.baseline_multiplier IS
  'The cell''s rate over its baseline after this run (rate = baseline_mhr x baseline_multiplier). correction_multiplier is the change this run made.';

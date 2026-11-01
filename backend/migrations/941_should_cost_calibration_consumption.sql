-- ============================================================================
-- Migration 941: a should-cost actual/prediction pair calibrates the benchmark rates at most once
-- ============================================================================
-- Calibration (scripts/should-cost-calibrate.ts, operator-run; no longer an HTTP endpoint) multiplies the global BENCHMARK
-- mhr_records rates by a correction derived from actual/prediction pairs. Before, nothing recorded which pairs had been applied,
-- so every run re-applied the same factor and the rates compounded. Now each pair records the calibration run that consumed it,
-- and a run reads only pairs no run has consumed.
--
-- The tables come from legacy migration 177 and may not exist in every database, hence IF EXISTS. Idempotent.
-- ============================================================================

ALTER TABLE IF EXISTS public.should_cost_actuals
  ADD COLUMN IF NOT EXISTS calibration_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_history_id uuid;

DO $$
BEGIN
  IF to_regclass('public.should_cost_actuals') IS NULL OR to_regclass('public.rate_calibration_history') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'should_cost_actuals_calibration_history_fk') THEN
    ALTER TABLE public.should_cost_actuals ADD CONSTRAINT should_cost_actuals_calibration_history_fk
      FOREIGN KEY (calibration_history_id) REFERENCES public.rate_calibration_history(id) ON DELETE RESTRICT;
  END IF;
  -- consumed means: consumed by a recorded run (both or neither)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'should_cost_actuals_calibration_consumed_ck') THEN
    ALTER TABLE public.should_cost_actuals ADD CONSTRAINT should_cost_actuals_calibration_consumed_ck
      CHECK ((calibration_consumed_at IS NULL) = (calibration_history_id IS NULL));
  END IF;
  CREATE INDEX IF NOT EXISTS idx_should_cost_actuals_unconsumed
    ON public.should_cost_actuals (prediction_id) WHERE calibration_consumed_at IS NULL;

  -- Rates were calibrated before this migration without recording the pairs. Those pairs have already been applied (possibly
  -- more than once), so they must not be applied again: mark every pair that existed when a run was last logged as consumed by
  -- that run.
  UPDATE public.should_cost_actuals a
     SET calibration_consumed_at = h.calibrated_at, calibration_history_id = h.id
    FROM (SELECT id, calibrated_at FROM public.rate_calibration_history ORDER BY calibrated_at DESC LIMIT 1) h
   WHERE a.calibration_consumed_at IS NULL AND a.created_at <= h.calibrated_at;

  -- Only the service connection (the operator script) touches calibration data.
  REVOKE ALL ON public.should_cost_actuals, public.rate_calibration_history FROM PUBLIC, anon, authenticated;
END
$$;

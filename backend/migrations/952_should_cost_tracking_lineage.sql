-- ============================================================================
-- Migration 952: the should-cost calibration tables in the migration lineage
-- ============================================================================
-- should_cost_predictions, should_cost_actuals and rate_calibration_history were created by legacy migration 177
-- (backend/database/migrations/177_should_cost_tracking.sql), which is not in backend/migrations, so a database built from the
-- baseline and these migrations had none of them, and migration 941 and scripts/should-cost-calibrate.ts had nothing to work on.
-- This creates them as 177 did plus what 941 added, so a database built from migrations and one that ran 177 end up the same.
--
-- Also:
--   * should_cost_predictions.organization_id: a calibration cell needs pairs from at least two organizations
--     (src/modules/should-cost/calibration.ts), so each prediction records whose it is. Existing predictions take the
--     organization of their BOM item.
--   * Calibration data is read and written only by the operator script over the service connection. The tables have no
--     row-level security, and predictions carry another organization's costs, so signed-in users get no privileges on any of them.
--
-- Idempotent: IF NOT EXISTS throughout; constraints and indexes are added only when missing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.should_cost_predictions (
  id                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id                  uuid         REFERENCES public.bom_items(id) ON DELETE CASCADE,
  project_id                   uuid,
  user_id                      uuid,
  predicted_at                 timestamptz  NOT NULL DEFAULT now(),
  process_family               varchar(30),
  location                     varchar(50),
  predicted_material_cost_usd  decimal(12,4),
  predicted_process_cost_usd   decimal(12,4),
  predicted_tooling_cost_usd   decimal(12,4),
  predicted_total_cost_usd     decimal(12,4),
  predicted_cycle_time_min     decimal(10,4),
  cycle_time_source            varchar(30),
  mhr_source                   varchar(30),
  lhr_source                   varchar(30),
  material_source              varchar(30),
  feature_vector               jsonb,
  rate_snapshot                jsonb,
  confidence_score             decimal(4,3),
  confidence_breakdown         jsonb,
  engine_version               varchar(20)
);

CREATE TABLE IF NOT EXISTS public.rate_calibration_history (
  id                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  calibrated_at                timestamptz  NOT NULL DEFAULT now(),
  process_family               varchar(30),
  location                     varchar(50),
  correction_multiplier        decimal(8,4),
  sample_count                 int,
  mape_before                  decimal(6,2),
  mape_after                   decimal(6,2),
  bias_before                  decimal(6,2),
  bias_after                   decimal(6,2),
  pct_within_10pct_before      decimal(6,2),
  pct_within_10pct_after       decimal(6,2),
  method                       varchar(30),
  applied_to_mhr_ids           uuid[],
  notes                        text
);

CREATE TABLE IF NOT EXISTS public.should_cost_actuals (
  id                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id                uuid         REFERENCES public.should_cost_predictions(id) ON DELETE SET NULL,
  bom_item_id                  uuid         REFERENCES public.bom_items(id) ON DELETE CASCADE,
  project_id                   uuid,
  actual_type                  varchar(20)  NOT NULL,
  actual_total_cost_usd        decimal(12,4),
  actual_material_cost_usd     decimal(12,4),
  actual_process_cost_usd      decimal(12,4),
  actual_cycle_time_min        decimal(10,4),
  supplier_name                varchar(100),
  supplier_location            varchar(50),
  rfq_date                     date,
  entered_by_user_id           uuid,
  notes                        text,
  created_at                   timestamptz  NOT NULL DEFAULT now()
);

-- What 941 adds (941 skipped the tables when they did not exist yet).
ALTER TABLE public.should_cost_actuals
  ADD COLUMN IF NOT EXISTS calibration_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_history_id uuid;

ALTER TABLE public.should_cost_predictions ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'should_cost_actuals_calibration_history_fk') THEN
    ALTER TABLE public.should_cost_actuals ADD CONSTRAINT should_cost_actuals_calibration_history_fk
      FOREIGN KEY (calibration_history_id) REFERENCES public.rate_calibration_history(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'should_cost_actuals_calibration_consumed_ck') THEN
    ALTER TABLE public.should_cost_actuals ADD CONSTRAINT should_cost_actuals_calibration_consumed_ck
      CHECK ((calibration_consumed_at IS NULL) = (calibration_history_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'should_cost_predictions_organization_fk') THEN
    ALTER TABLE public.should_cost_predictions ADD CONSTRAINT should_cost_predictions_organization_fk
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  END IF;
END
$$;

UPDATE public.should_cost_predictions p
   SET organization_id = b.organization_id
  FROM public.bom_items b
 WHERE p.organization_id IS NULL AND b.id = p.bom_item_id AND b.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scp_bom_item ON public.should_cost_predictions (bom_item_id);
CREATE INDEX IF NOT EXISTS idx_scp_family_location ON public.should_cost_predictions (process_family, location);
CREATE INDEX IF NOT EXISTS idx_scp_predicted_at ON public.should_cost_predictions (predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sca_prediction ON public.should_cost_actuals (prediction_id);
CREATE INDEX IF NOT EXISTS idx_sca_bom_item ON public.should_cost_actuals (bom_item_id);
CREATE INDEX IF NOT EXISTS idx_rch_family_location ON public.rate_calibration_history (process_family, location, calibrated_at DESC);
CREATE INDEX IF NOT EXISTS idx_should_cost_actuals_unconsumed
  ON public.should_cost_actuals (prediction_id) WHERE calibration_consumed_at IS NULL;

REVOKE ALL ON public.should_cost_predictions, public.should_cost_actuals, public.rate_calibration_history FROM PUBLIC, anon, authenticated;

-- 952 + 953 (applied by run.sh on top of the stubs, as on a database built from the baseline and migrations): the should-cost
-- calibration tables exist with every column scripts/should-cost-calibrate.ts reads or writes, signed-in users have no access,
-- existing predictions take their BOM item's organization, and both migrations can run again. Then a database that ran legacy
-- 177 and 941 gets the same columns from 952.
INSERT INTO public.organizations (id) VALUES ('0a000000-0000-4000-8000-000000000001');
INSERT INTO public.bom_items (id, organization_id) VALUES ('0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001');
INSERT INTO public.should_cost_predictions (id, bom_item_id, process_family, location, predicted_total_cost_usd)
VALUES ('0c000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'milled', 'India', 10),
       ('0c000000-0000-4000-8000-000000000002', NULL, 'milled', 'India', 10);

\i /migrations/952_should_cost_tracking_lineage.sql
\i /migrations/953_mhr_calibration_baseline.sql

CREATE FUNCTION pg_temp.has_column(t text, c text) RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t AND column_name = c) $$;

DO $$
DECLARE
  required text[][] := ARRAY[
    ['should_cost_actuals', 'prediction_id'], ['should_cost_actuals', 'actual_total_cost_usd'],
    ['should_cost_actuals', 'calibration_consumed_at'], ['should_cost_actuals', 'calibration_history_id'],
    ['should_cost_predictions', 'predicted_total_cost_usd'], ['should_cost_predictions', 'process_family'],
    ['should_cost_predictions', 'location'], ['should_cost_predictions', 'organization_id'],
    ['rate_calibration_history', 'correction_multiplier'], ['rate_calibration_history', 'baseline_multiplier'],
    ['rate_calibration_history', 'applied_to_mhr_ids'], ['rate_calibration_history', 'pct_within_10pct_after'],
    ['mhr_records', 'baseline_mhr'], ['mhr_records', 'baseline_mhr_usd_per_hour']];
  i int;
BEGIN
  FOR i IN 1 .. array_length(required, 1) LOOP
    ASSERT pg_temp.has_column(required[i][1], required[i][2]), format('%s.%s exists', required[i][1], required[i][2]);
  END LOOP;
  ASSERT (SELECT organization_id FROM public.should_cost_predictions WHERE id = '0c000000-0000-4000-8000-000000000001')
    = '0a000000-0000-4000-8000-000000000001', 'a prediction takes its BOM item''s organization';
  ASSERT (SELECT organization_id IS NULL FROM public.should_cost_predictions WHERE id = '0c000000-0000-4000-8000-000000000002'),
    'a prediction with no BOM item has no organization (calibration does not count it)';
  ASSERT NOT has_table_privilege('authenticated', 'public.should_cost_predictions', 'SELECT'), 'signed-in users cannot read predictions';
  ASSERT NOT has_table_privilege('authenticated', 'public.should_cost_actuals', 'INSERT'), 'nor add actuals';
  ASSERT NOT has_table_privilege('authenticated', 'public.rate_calibration_history', 'SELECT'), 'nor read the history directly';
  ASSERT NOT has_table_privilege('anon', 'public.should_cost_predictions', 'SELECT'), 'anon has nothing';
  BEGIN
    INSERT INTO public.should_cost_actuals (actual_type, calibration_consumed_at) VALUES ('po_invoice', now());
    RAISE EXCEPTION 'consumed without a run';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- A database that ran legacy 177 (and 941) before 952 existed: 177's tables, here with the columns 952 indexes or calibration reads.
DROP TABLE public.should_cost_actuals, public.should_cost_predictions, public.rate_calibration_history CASCADE;
CREATE TABLE public.should_cost_predictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bom_item_id uuid, predicted_at timestamptz NOT NULL DEFAULT now(), process_family varchar(30), location varchar(50), predicted_total_cost_usd decimal(12,4));
CREATE TABLE public.should_cost_actuals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prediction_id uuid, bom_item_id uuid, actual_type varchar(20) NOT NULL, actual_total_cost_usd decimal(12,4), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.rate_calibration_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), calibrated_at timestamptz NOT NULL DEFAULT now(), process_family varchar(30), location varchar(50), correction_multiplier decimal(8,4));
GRANT ALL ON public.should_cost_actuals, public.should_cost_predictions, public.rate_calibration_history TO authenticated;
\i /migrations/941_should_cost_calibration_consumption.sql
\i /migrations/952_should_cost_tracking_lineage.sql
\i /migrations/953_mhr_calibration_baseline.sql

DO $$
BEGIN
  ASSERT pg_temp.has_column('should_cost_predictions', 'organization_id'), 'a legacy database gets organization_id';
  ASSERT pg_temp.has_column('rate_calibration_history', 'baseline_multiplier'), 'and baseline_multiplier';
  ASSERT NOT has_table_privilege('authenticated', 'public.should_cost_predictions', 'SELECT'), 'and loses the signed-in grants';
END $$;

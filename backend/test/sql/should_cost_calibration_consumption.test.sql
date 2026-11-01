-- 941: a calibration run records the pairs it consumed; pairs that predate 941 and were already applied by a logged run are
-- marked consumed so they are never applied again; signed-in users cannot touch calibration data. Tables as legacy 177 has them
-- (only the columns 941 relies on).
CREATE TABLE public.should_cost_actuals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), prediction_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.rate_calibration_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), calibrated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.should_cost_actuals, public.rate_calibration_history TO authenticated;
INSERT INTO public.should_cost_actuals (id, created_at) VALUES
  ('11111111-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('11111111-0000-4000-8000-000000000002', now());
INSERT INTO public.rate_calibration_history (id, calibrated_at) VALUES ('22222222-0000-4000-8000-000000000001', now() - interval '1 day');

\i /migrations/941_should_cost_calibration_consumption.sql
\i /migrations/941_should_cost_calibration_consumption.sql

DO $$
BEGIN
  ASSERT (SELECT calibration_history_id FROM public.should_cost_actuals WHERE id = '11111111-0000-4000-8000-000000000001')
    = '22222222-0000-4000-8000-000000000001', 'a pair older than the last logged run counts as consumed by it';
  ASSERT (SELECT calibration_consumed_at IS NULL FROM public.should_cost_actuals WHERE id = '11111111-0000-4000-8000-000000000002'),
    'a newer pair stays available';
  BEGIN
    UPDATE public.should_cost_actuals SET calibration_consumed_at = now() WHERE id = '11111111-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'consumed without a run';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  ASSERT NOT has_table_privilege('authenticated', 'public.should_cost_actuals', 'INSERT'), 'signed-in users cannot add actuals';
  ASSERT NOT has_table_privilege('authenticated', 'public.rate_calibration_history', 'SELECT'), 'nor read the history directly';
END $$;

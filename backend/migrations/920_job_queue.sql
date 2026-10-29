-- ============================================================================
-- Migration 920: a small Postgres job queue (replaces pg-boss for the electronics jobs)
-- ============================================================================
-- pg-boss needed a direct Postgres connection from the backend, its own schema and its own migrations. This is the same pattern
-- cad_uploads already uses (a table that is the queue and the job record, claimed with FOR UPDATE SKIP LOCKED), so the backend
-- reaches it over the Supabase API like everything else and holds no database connection or password.
--
-- Payloads and outputs hold ids only. Only the service role touches the table (RLS on, no policies, no grants to API roles).
-- Retry: a failed attempt goes back to 'queued' with exponential back-off until max_attempts; a runner that died mid-job leaves
-- the row 'running', and it is claimed again once it is stale. Finished rows are pruned after 7 days.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.job_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue        text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  state        text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_at    timestamptz,
  output       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX IF NOT EXISTS job_queue_ready ON public.job_queue (queue, run_at) WHERE state IN ('queued', 'running');

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_queue FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_job(p_queue text, p_payload jsonb, p_max_attempts integer DEFAULT 3)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.job_queue (queue, payload, max_attempts) VALUES (p_queue, p_payload, p_max_attempts) RETURNING id;
$$;

-- Claims the oldest runnable job of a queue (queued and due, or 'running' and stale). A stale job that has used all its attempts
-- is failed instead of being claimed again.
CREATE OR REPLACE FUNCTION public.claim_next_job(p_queue text, p_stale_seconds integer DEFAULT 900)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.job_queue;
BEGIN
  UPDATE public.job_queue
     SET state = 'failed', error = 'worker_crashed', finished_at = now()
   WHERE queue = p_queue AND state = 'running'
     AND locked_at < now() - make_interval(secs => p_stale_seconds)
     AND attempts >= max_attempts;

  SELECT * INTO claimed
    FROM public.job_queue
   WHERE queue = p_queue
     AND ((state = 'queued' AND run_at <= now())
          OR (state = 'running' AND locked_at < now() - make_interval(secs => p_stale_seconds)))
   ORDER BY run_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.job_queue
     SET state = 'running', attempts = attempts + 1, locked_at = now()
   WHERE id = claimed.id
   RETURNING * INTO claimed;
  RETURN NEXT claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job(p_id uuid, p_output jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.job_queue SET state = 'completed', output = p_output, error = NULL, locked_at = NULL, finished_at = now()
   WHERE id = p_id AND state = 'running';
$$;

-- A failed attempt retries after 5 s, 10 s, 20 s ... until max_attempts, then the job is failed with the last error.
CREATE OR REPLACE FUNCTION public.fail_job(p_id uuid, p_error text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.job_queue
     SET state       = CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END,
         run_at      = CASE WHEN attempts < max_attempts THEN now() + make_interval(secs => 5 * power(2, attempts - 1)) ELSE run_at END,
         error       = left(p_error, 500),
         locked_at   = NULL,
         finished_at = CASE WHEN attempts < max_attempts THEN NULL ELSE now() END
   WHERE id = p_id AND state = 'running';
$$;

CREATE OR REPLACE FUNCTION public.prune_job_queue()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.job_queue WHERE state IN ('completed', 'failed') AND finished_at < now() - interval '7 days';
$$;

REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, integer), public.claim_next_job(text, integer), public.complete_job(uuid, jsonb),
  public.fail_job(uuid, text), public.prune_job_queue() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, integer), public.claim_next_job(text, integer), public.complete_job(uuid, jsonb),
  public.fail_job(uuid, text), public.prune_job_queue() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-job-queue') THEN
      PERFORM cron.unschedule('prune-job-queue');
    END IF;
    PERFORM cron.schedule('prune-job-queue', '47 3 * * *', 'SELECT public.prune_job_queue()');
  ELSE
    RAISE NOTICE 'pg_cron is not available: schedule SELECT public.prune_job_queue() with an external scheduler';
  END IF;
END
$$;

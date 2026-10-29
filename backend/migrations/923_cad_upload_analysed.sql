-- ============================================================================
-- Migration 923: a CAD upload can be `analysed` before its BOM items exist
-- ============================================================================
-- With the Rust assembly core (core/, docs/ASSEMBLY_CORE.md) the work is split in two. `cad-runner` unzips, runs the C++ geometry
-- worker, verifies the result and stores one STEP file per distinct part; it ends the upload as `analysed`. NestJS then
-- materializes it: creates the BOM items from the stored report (the BOM rules, audit events and file paths live there) and ends it
-- as `done`. `materializing` is that second step in flight, kept apart from `running` so the analysis runner never re-claims it.
--   queued -> running -> analysed -> materializing -> done          (failed from any step)
-- The existing path (NestJS does everything and ends at `done`) is unchanged. Idempotent.
-- ============================================================================

ALTER TABLE public.cad_uploads ADD COLUMN IF NOT EXISTS materialize_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.cad_uploads DROP CONSTRAINT IF EXISTS cad_uploads_status_check;
ALTER TABLE public.cad_uploads ADD CONSTRAINT cad_uploads_status_check
  CHECK (status IN ('queued', 'running', 'analysed', 'materializing', 'done', 'failed'));

DROP INDEX IF EXISTS public.cad_uploads_queue;
CREATE INDEX IF NOT EXISTS cad_uploads_queue ON public.cad_uploads (created_at) WHERE status IN ('queued', 'running', 'analysed', 'materializing');

-- Claims the oldest analysed upload, or one a materializer left in `materializing` (older than p_stale_seconds). One that has
-- already been tried p_max_attempts times is failed instead of being claimed again.
CREATE OR REPLACE FUNCTION public.claim_next_analysed_upload(p_stale_seconds integer DEFAULT 900, p_max_attempts integer DEFAULT 3)
RETURNS SETOF public.cad_uploads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.cad_uploads;
BEGIN
  UPDATE public.cad_uploads
     SET status = 'failed', error_code = 'materialize_crashed', finished_at = now()
   WHERE status = 'materializing'
     AND started_at < now() - make_interval(secs => p_stale_seconds)
     AND materialize_attempts >= p_max_attempts;

  SELECT * INTO claimed
    FROM public.cad_uploads
   WHERE status = 'analysed'
      OR (status = 'materializing' AND started_at < now() - make_interval(secs => p_stale_seconds))
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.cad_uploads
     SET status = 'materializing', materialize_attempts = materialize_attempts + 1, started_at = now(), error_code = NULL, error_detail = NULL
   WHERE id = claimed.id
  RETURNING * INTO claimed;
  RETURN NEXT claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_analysed_upload(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_analysed_upload(integer, integer) TO service_role;

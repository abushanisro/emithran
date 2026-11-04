-- ============================================================================
-- Migration 955: casting_analyses, the durable queue and result store of the sand casting module
-- ============================================================================
-- One row per (BOM item, STEP file, worker version, result schema version, analysis configuration). The row IS the job, as in
-- cad_uploads (917): status, attempts, error and the worker's validated result.json live here. Casting analysis is lazy: a row
-- exists only after someone asked for it, and no row means "not requested" (never "passed").
--
-- input_sha256 is the SHA-256 of the part's STEP bytes. It is the cache identity of the file, not yet a normalized geometry
-- hash (the same shape exported twice can differ); a geometry fingerprint arrives with the face references (design step S7).
-- worker_version, schema_version and config_hash are what the geometry result depends on besides the file: a new worker or
-- configuration creates a new row, it never rewrites an old result. The API reuses a finished row of the same organization
-- with the same key for another BOM item instead of running the worker again.
--
-- Writes are made by the backend (service role) after it has checked, as the user, that the BOM item is visible; end users
-- only read, and only their organization's rows. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.casting_analyses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  bom_item_id     uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  requested_by    uuid NOT NULL,
  input_sha256    text NOT NULL,
  source_path     text,             -- the BOM item's 3D file path when it was asked for: a replaced file has a new path, so its old analysis is not used for it
  worker_version  text NOT NULL,
  schema_version  integer NOT NULL,
  config_hash     text NOT NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  error_code      text,
  error_detail    text,
  result          jsonb,            -- the worker's result.json (schema_version inside), only for succeeded and partial
  output_prefix   text,             -- where the worker's other files (GLB meshes) are stored; a reused row points at the original's
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  UNIQUE (bom_item_id, input_sha256, worker_version, schema_version, config_hash)
);

CREATE INDEX IF NOT EXISTS casting_analyses_queue ON public.casting_analyses (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS casting_analyses_reuse
  ON public.casting_analyses (organization_id, input_sha256, worker_version, schema_version, config_hash)
  WHERE status IN ('succeeded', 'partial');

ALTER TABLE public.casting_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_casting_analyses ON public.casting_analyses;
CREATE POLICY org_select_casting_analyses ON public.casting_analyses FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

-- Claims the oldest queued row, or a row left 'running' by a runner that died (older than p_stale_seconds). A row already tried
-- p_max_attempts times is failed instead of being claimed again.
CREATE OR REPLACE FUNCTION public.claim_next_casting_analysis(p_stale_seconds integer DEFAULT 900, p_max_attempts integer DEFAULT 3)
RETURNS SETOF public.casting_analyses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.casting_analyses;
BEGIN
  UPDATE public.casting_analyses
     SET status = 'failed', error_code = 'worker_crashed', finished_at = now()
   WHERE status = 'running'
     AND started_at < now() - make_interval(secs => p_stale_seconds)
     AND attempts >= p_max_attempts;

  SELECT * INTO claimed
    FROM public.casting_analyses
   WHERE status = 'queued'
      OR (status = 'running' AND started_at < now() - make_interval(secs => p_stale_seconds))
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.casting_analyses
     SET status = 'running', attempts = attempts + 1, started_at = now(), error_code = NULL, error_detail = NULL
   WHERE id = claimed.id
  RETURNING * INTO claimed;
  RETURN NEXT claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_casting_analysis(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_casting_analysis(integer, integer) TO service_role;

-- Same table privileges as cad_uploads: signed-in users read through the policy; only the service role writes.
REVOKE ALL ON public.casting_analyses FROM PUBLIC, anon;
GRANT SELECT ON public.casting_analyses TO authenticated;
GRANT ALL ON public.casting_analyses TO service_role;

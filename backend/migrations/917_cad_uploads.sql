-- ============================================================================
-- Migration 917: cad_uploads, the durable queue behind ZIP / STEP assembly upload
-- ============================================================================
-- One row per uploaded file. The row IS the job: status, attempts, error and the engine's result live here, so
-- there is no second store to reconcile. The API only stores the bytes and inserts the row; a runner claims rows
-- with claim_next_cad_upload() (FOR UPDATE SKIP LOCKED, so several runners never take the same row) and does the
-- unzip, the engine call and the BOM item creation.
--
-- Identical bytes uploaded to the same BOM resolve to the existing row (unique bom_id + sha256). Writes are made
-- by the backend (service role) after it has checked the caller can see the BOM; end users only read.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cad_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_by      uuid NOT NULL,
  bom_id          uuid NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  file_name       text NOT NULL,
  sha256          text NOT NULL,
  size_bytes      bigint NOT NULL,
  storage_path    text NOT NULL,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts        integer NOT NULL DEFAULT 0,
  error_code      text,
  error_detail    text,
  result          jsonb,                                  -- the engine's /analyze/assembly report (schema_version inside)
  created_item_ids uuid[] NOT NULL DEFAULT '{}',         -- every BOM item this upload created, so a retry can remove them first
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  UNIQUE (bom_id, sha256)
);

CREATE INDEX IF NOT EXISTS cad_uploads_queue ON public.cad_uploads (created_at) WHERE status IN ('queued', 'running');

ALTER TABLE public.cad_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_cad_uploads ON public.cad_uploads;
CREATE POLICY org_select_cad_uploads ON public.cad_uploads FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

-- Claims the oldest queued row, or a row left 'running' by a runner that died (older than p_stale_seconds).
-- A row that has already been tried p_max_attempts times is failed instead of being claimed again.
CREATE OR REPLACE FUNCTION public.claim_next_cad_upload(p_stale_seconds integer DEFAULT 900, p_max_attempts integer DEFAULT 3)
RETURNS SETOF public.cad_uploads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.cad_uploads;
BEGIN
  UPDATE public.cad_uploads
     SET status = 'failed', error_code = 'worker_crashed', finished_at = now()
   WHERE status = 'running'
     AND started_at < now() - make_interval(secs => p_stale_seconds)
     AND attempts >= p_max_attempts;

  SELECT * INTO claimed
    FROM public.cad_uploads
   WHERE status = 'queued'
      OR (status = 'running' AND started_at < now() - make_interval(secs => p_stale_seconds))
   ORDER BY created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.cad_uploads
     SET status = 'running', attempts = attempts + 1, started_at = now(), error_code = NULL, error_detail = NULL
   WHERE id = claimed.id
  RETURNING * INTO claimed;
  RETURN NEXT claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_cad_upload(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_cad_upload(integer, integer) TO service_role;

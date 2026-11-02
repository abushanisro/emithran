-- ============================================================================
-- Migration 951: cad_runner, the database role of the Rust analysis runner (cad-core, docs/ASSEMBLY_CORE.md)
-- ============================================================================
-- The runner used to act as service_role, which bypasses row-level security on every table. It needs three things only: claim
-- a queued upload (claim_next_cad_upload, 917) and finish the upload it claimed, as `analysed` with its report or as failed
-- (for good, or back to the queue). cad_runner gets exactly that: EXECUTE on three functions and no table, view or sequence
-- privilege at all, so RLS policies never apply to it and BYPASSRLS is not needed. The two finishing functions change only an
-- upload that is still `running`, and only the columns the runner used to PATCH.
-- PostgREST switches to the role named in the token, so authenticator must be granted it. Idempotent.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cad_runner') THEN
    CREATE ROLE cad_runner NOLOGIN NOINHERIT;
  END IF;
END
$$;

GRANT cad_runner TO authenticator;
GRANT USAGE ON SCHEMA public TO cad_runner;

-- The report is stored and the upload handed to the materializer (923). False when the upload is not `running` (finished
-- already, removed with its BOM, or never claimed): nothing is changed then.
CREATE OR REPLACE FUNCTION public.cad_runner_mark_analysed(p_id uuid, p_result jsonb)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH changed AS (
    UPDATE public.cad_uploads
       SET status = 'analysed', result = p_result, error_code = NULL, error_detail = NULL
     WHERE id = p_id AND status = 'running'
    RETURNING 1
  )
  SELECT EXISTS (SELECT FROM changed);
$$;

-- p_retry: back to the queue with the reason (claim_next_cad_upload counts the attempts); otherwise failed for good with the
-- code. The texts are bounded here as well as in the runner.
CREATE OR REPLACE FUNCTION public.cad_runner_mark_failed(p_id uuid, p_retry boolean, p_code text, p_detail text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH changed AS (
    UPDATE public.cad_uploads
       SET status       = CASE WHEN p_retry THEN 'queued' ELSE 'failed' END,
           error_code   = CASE WHEN p_retry THEN NULL ELSE left(p_code, 64) END,
           error_detail = left(p_detail, 500),
           finished_at  = CASE WHEN p_retry THEN NULL ELSE now() END
     WHERE id = p_id AND status = 'running'
    RETURNING 1
  )
  SELECT EXISTS (SELECT FROM changed);
$$;

REVOKE ALL ON FUNCTION public.cad_runner_mark_analysed(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cad_runner_mark_failed(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cad_runner_mark_analysed(uuid, jsonb) TO cad_runner;
GRANT EXECUTE ON FUNCTION public.cad_runner_mark_failed(uuid, boolean, text, text) TO cad_runner;
GRANT EXECUTE ON FUNCTION public.claim_next_cad_upload(integer, integer) TO cad_runner;

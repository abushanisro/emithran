-- ============================================================================
-- Migration 918: housekeeping that keeps a Supabase free-tier project inside its limits
-- ============================================================================
-- The free tier gives 0.5 GB of database and 1 GB of storage. Several tables only ever grew and uploads were kept forever,
-- so this adds three things:
--   1. cad_uploads.source_deleted_at: marks that the stored original zip/STEP was removed (rows and hashes stay, for dedupe and audit).
--   2. file_paths_in_use(): which of these storage paths are still referenced, so shared part files are never deleted from under
--      another item. It finds every bom_items.file_*_path column itself, so a column added later is covered automatically.
--   3. prune_old_rows() + a nightly pg_cron job: bounded retention for the unbounded tables. Each prune is independent: a table
--      that does not exist in a project is skipped, and one failure never stops the others.
-- Idempotent.
-- ============================================================================

ALTER TABLE public.cad_uploads ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.file_paths_in_use(p_paths text[])
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col text;
  found text[];
  in_use text[] := '{}';
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bom_items' AND column_name ~ '^file_.*_path$'
  LOOP
    EXECUTE format('SELECT coalesce(array_agg(DISTINCT %I), ''{}'') FROM public.bom_items WHERE %I = ANY($1)', col, col)
      INTO found USING p_paths;
    in_use := in_use || found;
  END LOOP;

  -- an upload whose original has not been removed still needs it (a retry reads it)
  SELECT coalesce(array_agg(DISTINCT storage_path), '{}') INTO found
  FROM public.cad_uploads WHERE storage_path = ANY(p_paths) AND source_deleted_at IS NULL;
  RETURN in_use || found;
END;
$$;

CREATE OR REPLACE FUNCTION public.prune_old_rows()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed jsonb := '{}'::jsonb;
  n bigint;
BEGIN
  BEGIN  -- request log: 14 days is enough to investigate a problem
    DELETE FROM api_request_logs WHERE created_at < now() - interval '14 days';
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('api_request_logs', n);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'prune api_request_logs: %', SQLERRM; END;

  BEGIN  -- FX snapshots: 90 days, but never the newest rate of a currency pair
    DELETE FROM fx_rate_snapshots
    WHERE created_at < now() - interval '90 days'
      AND id NOT IN (SELECT DISTINCT ON (provider, base_currency, quote_currency) id
                     FROM fx_rate_snapshots ORDER BY provider, base_currency, quote_currency, rate_date DESC);
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('fx_rate_snapshots', n);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'prune fx_rate_snapshots: %', SQLERRM; END;

  BEGIN  -- analysis history: the last 3 per item (each row carries a full analysis)
    DELETE FROM cad_analysis_history h
    USING (SELECT id, row_number() OVER (PARTITION BY bom_item_id ORDER BY created_at DESC) AS rn FROM cad_analysis_history) ranked
    WHERE h.id = ranked.id AND ranked.rn > 3;
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('cad_analysis_history', n);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'prune cad_analysis_history: %', SQLERRM; END;

  BEGIN  -- analysis cache: its own expiry rules (24 h, or untouched for 7 days)
    PERFORM cleanup_cad_analysis_cache();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'prune cad_analysis_cache: %', SQLERRM; END;

  BEGIN  -- uploads that failed and were never retried: 30 days
    DELETE FROM cad_uploads WHERE status = 'failed' AND coalesce(finished_at, created_at) < now() - interval '30 days';
    GET DIAGNOSTICS n = ROW_COUNT; removed := removed || jsonb_build_object('cad_uploads', n);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'prune cad_uploads: %', SQLERRM; END;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.file_paths_in_use(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_old_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.file_paths_in_use(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_old_rows() TO service_role;

-- Nightly at 03:17 UTC. pg_cron is available on every Supabase plan; where it is not, call prune_old_rows() from any scheduler.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-old-rows') THEN
      PERFORM cron.unschedule('prune-old-rows');
    END IF;
    PERFORM cron.schedule('prune-old-rows', '17 3 * * *', 'SELECT public.prune_old_rows()');
  ELSE
    RAISE NOTICE 'pg_cron is not available: schedule SELECT public.prune_old_rows() with an external scheduler';
  END IF;
END
$$;

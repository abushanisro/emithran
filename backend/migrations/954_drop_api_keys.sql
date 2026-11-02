-- ============================================================================
-- Migration 954: API keys and the developer portal are removed.
--
-- Keys (migrations 200, 935, 944) never opened anything the signed-in app does not already offer, and every path into the backend
-- is now a signed-in person. Dropped here: the key table (and the policies and grants on it), the lookup function the backend
-- used to authenticate a key, the helper only the key policy used, and the request log table (the backend stopped writing to it
-- on 2026-10-27; only errors are kept, in the error log file).
--
-- prune_old_rows() (918) is redefined without the request-log block, so the nightly run does not warn about a missing table.
-- Idempotent.
-- ============================================================================

DROP FUNCTION IF EXISTS public.authenticate_api_key(text);
DROP TABLE IF EXISTS public.api_keys CASCADE;
DROP FUNCTION IF EXISTS public.my_sole_active_organization();
DROP TABLE IF EXISTS public.api_request_logs CASCADE;

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

REVOKE ALL ON FUNCTION public.prune_old_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_old_rows() TO service_role;

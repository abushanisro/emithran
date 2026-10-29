-- ============================================================================
-- Migration 919: audit_events, an append-only record of who did what
-- ============================================================================
-- State-changing and security events only (uploads, deletes, cost apply, exports, RFQ sends, denied access); never one row
-- per request. Sign-ins are NOT recorded here: Supabase Auth already keeps them in auth.audit_log_entries.
--
-- Same shape as pmi_record_reviews (migration 908): row-level security on, API roles cannot write, and the only way to add a
-- row is record_audit_event(), callable by the service role alone. Rows cannot be changed or removed except by the retention
-- function. About 200 bytes a row (two small indexes), so 90 days at 2,000 events a day is roughly 45 MB of the free tier's 0.5 GB.
--
-- Who may read: an active owner or admin of the organization. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  org_id      uuid,                                   -- null when the organization could not be determined (e.g. a denied request)
  actor_id    uuid,                                   -- null for the system
  actor_kind  text NOT NULL CHECK (actor_kind IN ('user', 'service', 'system')),
  action      text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),          -- area.verb, e.g. bom_item.deleted
  target_type text,
  target_id   text,
  outcome     text NOT NULL DEFAULT 'ok' CHECK (outcome IN ('ok', 'denied', 'error')),
  ip          inet,
  request_id  text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object' AND octet_length(meta::text) < 2048)
);

CREATE INDEX IF NOT EXISTS audit_events_org_at ON public.audit_events (org_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_at ON public.audit_events (actor_id, at DESC) WHERE actor_id IS NOT NULL;

-- Organizations the signed-in user administers. A function, because organization_members is itself protected by row-level
-- security (the same reason current_user_org_ids() exists).
CREATE OR REPLACE FUNCTION public.current_user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.organization_members
  WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
$$;
REVOKE ALL ON FUNCTION public.current_user_admin_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_admin_org_ids() TO authenticated;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_select_audit_events ON public.audit_events;
CREATE POLICY admin_select_audit_events ON public.audit_events FOR SELECT
  USING (org_id IN (SELECT current_user_admin_org_ids()));

-- Supabase grants new tables to the API roles by default; take everything back and give back only reading (still gated by the policy).
REVOKE ALL ON public.audit_events FROM anon, authenticated;
GRANT SELECT ON public.audit_events TO authenticated;

-- Append-only: nothing changes or removes a row, except the retention function, which says so for its own transaction.
CREATE OR REPLACE FUNCTION public.audit_events_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.audit_prune', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS audit_events_no_change ON public.audit_events;
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW EXECUTE FUNCTION public.audit_events_guard();
DROP TRIGGER IF EXISTS audit_events_no_truncate ON public.audit_events;
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_events_guard();

-- The one writer.
CREATE OR REPLACE FUNCTION public.record_audit_event(
  p_org uuid, p_actor uuid, p_actor_kind text, p_action text, p_target_type text, p_target_id text,
  p_outcome text, p_ip inet, p_request_id text, p_meta jsonb
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.audit_events (org_id, actor_id, actor_kind, action, target_type, target_id, outcome, ip, request_id, meta)
  VALUES (p_org, p_actor, p_actor_kind, p_action, p_target_type, p_target_id, coalesce(p_outcome, 'ok'), p_ip, p_request_id, coalesce(p_meta, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_audit_event(uuid, uuid, text, text, text, text, text, inet, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_audit_event(uuid, uuid, text, text, text, text, text, inet, text, jsonb) TO service_role;

-- Retention. The length comes from the database setting app.audit_retention_days (default 90): to keep a year in production,
--   ALTER DATABASE postgres SET app.audit_retention_days = '365';
CREATE OR REPLACE FUNCTION public.prune_audit_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := coalesce(nullif(current_setting('app.audit_retention_days', true), '')::integer, 90);
  n bigint;
BEGIN
  PERFORM set_config('app.audit_prune', 'on', true);
  DELETE FROM public.audit_events WHERE at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.audit_prune', 'off', true);   -- the allowance covers the delete above and nothing after it
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_audit_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_audit_events() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-audit-events') THEN
      PERFORM cron.unschedule('prune-audit-events');
    END IF;
    PERFORM cron.schedule('prune-audit-events', '37 3 * * *', 'SELECT public.prune_audit_events()');
  ELSE
    RAISE NOTICE 'pg_cron is not available: schedule SELECT public.prune_audit_events() with an external scheduler';
  END IF;
END
$$;

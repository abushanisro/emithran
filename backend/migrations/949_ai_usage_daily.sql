-- ============================================================================
-- Migration 949: AI token usage per user, organization and UTC day (decision D6)
-- ============================================================================
-- Before: the only cap on AI spend was an in-memory request counter per Next.js route and instance; nothing counted tokens, so
-- one user could spend the deployment's Anthropic budget.
--
-- Now the backend's AiBudgetService (src/common/ai/ai-budget.service.ts), the only holder of the API key, reads today's totals
-- before every model call and adds the call's real usage (Anthropic response.usage) after it. Limits come from the environment
-- (AI_USER_DAILY_TOKENS, AI_ORG_DAILY_TOKENS, AI_GLOBAL_DAILY_TOKENS), not from this table.
--
--   * ai_usage_daily: one row per UTC day, user and organization; tokens = input (including cached) + output.
--   * Users read only their own rows; nobody writes the table directly. The two functions below are the only way in:
--       ai_usage_today(org)                    today's user, organization and deployment totals;
--       ai_usage_record(org, input, output)    adds one call's usage, atomically (INSERT .. ON CONFLICT DO UPDATE).
--     Both act for auth.uid() only and refuse an organization the caller is not an active member of (42501). They are
--     SECURITY DEFINER because the organization and deployment totals sum other users' rows; they only add non-negative
--     amounts to the caller's own row, so a caller can never lower a total.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  usage_date      date NOT NULL,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  input_tokens    bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens   bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  calls           integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, user_id, organization_id)
);
COMMENT ON TABLE public.ai_usage_daily IS
  'AI tokens spent per UTC day, user and organization (AiBudgetService). Written only by ai_usage_record().';
CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_org ON public.ai_usage_daily (usage_date, organization_id);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_usage_daily TO authenticated;
GRANT ALL ON public.ai_usage_daily TO service_role;

DROP POLICY IF EXISTS ai_usage_daily_own_select ON public.ai_usage_daily;
CREATE POLICY ai_usage_daily_own_select ON public.ai_usage_daily FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.ai_usage_today(p_organization_id uuid)
RETURNS TABLE (user_tokens bigint, organization_tokens bigint, global_tokens bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF v_uid IS NULL OR p_organization_id IS NULL OR p_organization_id NOT IN (SELECT public.current_user_org_ids()) THEN
    RAISE EXCEPTION 'not a member of organization %', p_organization_id USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT coalesce(sum(u.input_tokens + u.output_tokens) FILTER (WHERE u.user_id = v_uid), 0)::bigint,
           coalesce(sum(u.input_tokens + u.output_tokens) FILTER (WHERE u.organization_id = p_organization_id), 0)::bigint,
           coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint
      FROM public.ai_usage_daily u
     WHERE u.usage_date = v_day;
END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_usage_record(p_organization_id uuid, p_input_tokens bigint, p_output_tokens bigint)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_organization_id IS NULL OR p_organization_id NOT IN (SELECT public.current_user_org_ids()) THEN
    RAISE EXCEPTION 'not a member of organization %', p_organization_id USING ERRCODE = '42501';
  END IF;
  IF p_input_tokens IS NULL OR p_output_tokens IS NULL OR p_input_tokens < 0 OR p_output_tokens < 0 THEN
    RAISE EXCEPTION 'token counts must be non-negative' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ai_usage_daily AS u (usage_date, user_id, organization_id, input_tokens, output_tokens, calls)
  VALUES ((now() AT TIME ZONE 'utc')::date, v_uid, p_organization_id, p_input_tokens, p_output_tokens, 1)
  ON CONFLICT (usage_date, user_id, organization_id) DO UPDATE
    SET input_tokens  = u.input_tokens + excluded.input_tokens,
        output_tokens = u.output_tokens + excluded.output_tokens,
        calls         = u.calls + 1,
        updated_at    = now();
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_usage_today(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_usage_record(uuid, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_usage_today(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_usage_record(uuid, bigint, bigint) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 940: budget exchange rates are set per organization
-- ============================================================================
-- Before: PUT /api/fx/exchange-rates/:currency let any signed-in user of any tenant rewrite the one global exchange_rates
-- table (through set_budget_exchange_rate, service role), changing every tenant's costing.
--
-- Now:
--   * exchange_rates stays the read-only global default, maintained by migrations and operators (set_budget_exchange_rate
--     remains service-role only and the backend no longer calls it).
--   * organization_exchange_rates holds an organization's own budget rates, quoted like exchange_rates ("1 USD = rate CCY").
--     The effective rate of a currency for an organization is its active override, else the global default.
--   * Members read and write only their own organizations' rows (RLS on current_user_org_ids()). Writes go through
--     set_organization_exchange_rate(), which runs as the caller (SECURITY INVOKER), so RLS is the gate; a replaced rate is
--     kept as inactive history, like 803 does for the global table.
--   * get_organization_exchange_rates() refuses an organization the caller is not an active member of, so the backend can
--     never mistake "not a member" for "no overrides" and cache that for the organization.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organization_exchange_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  currency        varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'USD'),
  rate            numeric(12, 6) NOT NULL CHECK (rate > 0),
  is_active       boolean NOT NULL DEFAULT true,
  set_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason          text NOT NULL CHECK (btrim(reason) <> ''),
  effective_date  date NOT NULL DEFAULT current_date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.organization_exchange_rates IS
  'An organization''s own budget rates (1 USD = rate currency); overrides the global exchange_rates default for that organization only.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_exchange_rates_active
  ON public.organization_exchange_rates (organization_id, currency) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_organization_exchange_rates_org ON public.organization_exchange_rates (organization_id, currency);

ALTER TABLE public.organization_exchange_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_exchange_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.organization_exchange_rates TO authenticated;
GRANT UPDATE (is_active, updated_at) ON public.organization_exchange_rates TO authenticated;
GRANT ALL ON public.organization_exchange_rates TO service_role;

DROP POLICY IF EXISTS org_exchange_rates_select ON public.organization_exchange_rates;
CREATE POLICY org_exchange_rates_select ON public.organization_exchange_rates FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()));
DROP POLICY IF EXISTS org_exchange_rates_insert ON public.organization_exchange_rates;
CREATE POLICY org_exchange_rates_insert ON public.organization_exchange_rates FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()) AND set_by = auth.uid() AND is_active);
DROP POLICY IF EXISTS org_exchange_rates_update ON public.organization_exchange_rates;
CREATE POLICY org_exchange_rates_update ON public.organization_exchange_rates FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.current_user_org_ids()));

-- The caller's organization's active overrides. Refuses an organization the caller does not belong to.
CREATE OR REPLACE FUNCTION public.get_organization_exchange_rates(p_organization_id uuid)
RETURNS SETOF public.organization_exchange_rates
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF p_organization_id IS NULL OR p_organization_id NOT IN (SELECT public.current_user_org_ids()) THEN
    RAISE EXCEPTION 'not a member of organization %', p_organization_id USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.organization_exchange_rates
                WHERE organization_id = p_organization_id AND is_active ORDER BY currency;
END
$fn$;

-- Sets the organization's budget rate for one currency (1 USD = p_rate p_currency). The replaced override, if any, is kept as
-- inactive history. Only currencies that have a global default can be overridden.
CREATE OR REPLACE FUNCTION public.set_organization_exchange_rate(
  p_organization_id uuid, p_currency text, p_rate numeric, p_reason text
) RETURNS public.organization_exchange_rates
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE
  code text := upper(btrim(coalesce(p_currency, '')));
  next_row public.organization_exchange_rates;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL OR p_organization_id NOT IN (SELECT public.current_user_org_ids()) THEN
    RAISE EXCEPTION 'not a member of organization %', p_organization_id USING ERRCODE = '42501';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'exchange rate must be a positive number' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'a reason is required to change an exchange rate' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exchange_rates WHERE from_currency = 'USD' AND to_currency = code AND is_active) THEN
    RAISE EXCEPTION 'no active USD exchange rate for %', code USING ERRCODE = '22023';
  END IF;

  UPDATE public.organization_exchange_rates SET is_active = false, updated_at = now()
   WHERE organization_id = p_organization_id AND currency = code AND is_active;

  INSERT INTO public.organization_exchange_rates (organization_id, currency, rate, is_active, set_by, reason)
  VALUES (p_organization_id, code, p_rate, true, auth.uid(), btrim(p_reason))
  RETURNING * INTO next_row;
  RETURN next_row;
END
$fn$;

REVOKE ALL ON FUNCTION public.get_organization_exchange_rates(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_organization_exchange_rate(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_organization_exchange_rates(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_organization_exchange_rate(uuid, text, numeric, text) TO authenticated;

-- ============================================================================
-- Migration 944: organization-wide settings are changed by the organization's admins only (decision D5)
-- ============================================================================
-- organization_members.role was ignored: any active member could set the organization's budget exchange rates (940) and issue
-- API keys for it (935). Roles are now enforced: a viewer reads, a member edits project data, an admin (or the owner) changes
-- organization-wide settings. The API checks the role first (AuthzGuard, @OrgRole('admin')); the database decides the same thing
-- here, so a request that reaches the database some other way is refused as well.
--
--   * organization_exchange_rates: members still read their organizations' rates; inserting or retiring one needs an active
--     owner or admin membership of that organization (current_user_admin_org_ids(), 919). set_organization_exchange_rate()
--     refuses a non-admin with 42501 before it changes anything.
--   * api_keys: issuing a key needs an admin membership of the key's organization, in addition to 935's rules. Listing and
--     revoking one's own keys stay open to every member: revoking only ever removes access.
-- Idempotent.
-- ============================================================================

DROP POLICY IF EXISTS org_exchange_rates_insert ON public.organization_exchange_rates;
CREATE POLICY org_exchange_rates_insert ON public.organization_exchange_rates FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT public.current_user_admin_org_ids()) AND set_by = auth.uid() AND is_active);
DROP POLICY IF EXISTS org_exchange_rates_update ON public.organization_exchange_rates;
CREATE POLICY org_exchange_rates_update ON public.organization_exchange_rates FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT public.current_user_admin_org_ids()))
  WITH CHECK (organization_id IN (SELECT public.current_user_admin_org_ids()));

-- Same function as 940, with the admin check in place of the membership check.
CREATE OR REPLACE FUNCTION public.set_organization_exchange_rate(
  p_organization_id uuid, p_currency text, p_rate numeric, p_reason text
) RETURNS public.organization_exchange_rates
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $fn$
DECLARE
  code text := upper(btrim(coalesce(p_currency, '')));
  next_row public.organization_exchange_rates;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL
     OR p_organization_id NOT IN (SELECT public.current_user_admin_org_ids()) THEN
    RAISE EXCEPTION 'not an admin of organization %', p_organization_id USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.set_organization_exchange_rate(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_organization_exchange_rate(uuid, text, numeric, text) TO authenticated;

DROP POLICY IF EXISTS api_keys_user_insert ON public.api_keys;
CREATE POLICY api_keys_user_insert ON public.api_keys
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND organization_id = public.my_sole_active_organization()
    AND organization_id IN (SELECT public.current_user_admin_org_ids())
    AND revoked_at IS NULL
    AND expires_at > now() AND expires_at <= now() + interval '366 days'
  );

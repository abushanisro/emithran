-- ============================================================================
-- API keys authenticate requests (on-premises edition, step 3).
--
-- A key belongs to one user AND one organization, carries scopes from a closed list and always expires (at most a year). The
-- backend finds a key by the SHA-256 of the raw key through authenticate_api_key(), which only the service role may call; the
-- raw key is never stored. A key acts as its owner, so row-level security applies to it exactly as to that person.
--
-- Until the database carries the active organization per request, a key works only while its owner is an active member of
-- exactly one organization, the key's: row-level security then limits everything the key can read or write to that organization.
--
-- The scope list must match API_KEY_SCOPES in backend/src/common/api-keys/api-key-scopes.ts.
-- Idempotent.
-- ============================================================================

ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_api_keys_organization_id ON public.api_keys(organization_id);

-- Keys issued before this migration never authenticated anything, carry the old free-form scopes ('read', 'write') and no
-- organization. They are revoked; people issue new ones.
UPDATE public.api_keys SET revoked_at = now() WHERE revoked_at IS NULL AND organization_id IS NULL;

-- Every key that can still be used is complete: an organization, an expiry, and only known scopes.
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_usable_shape;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_usable_shape CHECK (
  revoked_at IS NOT NULL OR (
    organization_id IS NOT NULL
    AND expires_at IS NOT NULL
    AND cardinality(scopes) > 0
    AND scopes <@ ARRAY['projects:read', 'projects:write', 'boms:read', 'costing:read']::text[]
  )
);

-- The caller's one active organization, or NULL when they have none or several. Used by the insert policy below.
CREATE OR REPLACE FUNCTION public.my_sole_active_organization()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN count(DISTINCT m.organization_id) = 1 THEN (array_agg(DISTINCT m.organization_id))[1] END
    FROM public.organization_members m
   WHERE m.user_id = auth.uid() AND m.status = 'active'
$$;
REVOKE ALL ON FUNCTION public.my_sole_active_organization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_sole_active_organization() TO authenticated, service_role;

-- A person issues keys only for themselves, for their one organization, unrevoked, expiring within a year.
DROP POLICY IF EXISTS api_keys_user_insert ON public.api_keys;
CREATE POLICY api_keys_user_insert ON public.api_keys
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND organization_id = public.my_sole_active_organization()
    AND revoked_at IS NULL
    AND expires_at > now() AND expires_at <= now() + interval '366 days'
  );

-- The only change a person can make to a key is revoking it: no new scopes, no longer expiry, no un-revoking.
REVOKE UPDATE ON public.api_keys FROM authenticated;
GRANT UPDATE (revoked_at, updated_at) ON public.api_keys TO authenticated;
DROP POLICY IF EXISTS api_keys_user_update ON public.api_keys;
CREATE POLICY api_keys_user_update ON public.api_keys
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND revoked_at IS NOT NULL);

-- Looks a key up by its hash and says whether it may be used now:
--   ok | unknown | revoked | expired | not_authorized (owner no longer invited) | organization (owner is not in exactly the key's one
--   organization). The key's id and owner come back for every status except unknown, so a refusal can be audited.
-- A successful lookup records last_used_at, at most once a minute.
CREATE OR REPLACE FUNCTION public.authenticate_api_key(p_key_hash text)
RETURNS TABLE (status text, key_id uuid, user_id uuid, email text, organization_id uuid, scopes text[])
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  k public.api_keys%ROWTYPE;
  verdict text;
  sole uuid;
BEGIN
  SELECT * INTO k FROM public.api_keys a WHERE a.key_hash = p_key_hash;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::uuid, NULL::text[];
    RETURN;
  END IF;

  IF k.revoked_at IS NOT NULL THEN
    verdict := 'revoked';
  ELSIF k.expires_at IS NULL OR k.expires_at <= now() THEN
    verdict := 'expired';
  ELSIF NOT public.identity_is_authorized(k.user_id) THEN
    verdict := 'not_authorized';
  ELSE
    SELECT CASE WHEN count(DISTINCT m.organization_id) = 1 THEN (array_agg(DISTINCT m.organization_id))[1] END INTO sole
      FROM public.organization_members m
     WHERE m.user_id = k.user_id AND m.status = 'active';
    verdict := CASE WHEN sole IS NOT NULL AND sole = k.organization_id THEN 'ok' ELSE 'organization' END;
  END IF;

  IF verdict = 'ok' THEN
    UPDATE public.api_keys a SET last_used_at = now()
     WHERE a.id = k.id AND (a.last_used_at IS NULL OR a.last_used_at < now() - interval '1 minute');
  END IF;

  RETURN QUERY
    SELECT verdict, k.id, k.user_id, (SELECT u.email::text FROM auth.users u WHERE u.id = k.user_id), k.organization_id, k.scopes;
END;
$$;
REVOKE ALL ON FUNCTION public.authenticate_api_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_api_key(text) TO service_role;

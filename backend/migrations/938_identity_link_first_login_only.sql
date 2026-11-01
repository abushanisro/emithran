-- ============================================================================
-- Migration 938: a verified email links a NEW Auth0 login only to an account that has no login yet
-- ============================================================================
-- 931 linked every new (provider, sub) carrying a verified email to the existing account with that email, even when the account
-- already had a login. Any Auth0 connection able to assert email_verified for an address the caller does not own would then
-- take over that account. Now:
--   * a known (provider, sub) still resolves to its owner (unchanged);
--   * a new login links by verified email ONLY on the account's first sign-in (an invited user, no external identity yet);
--   * any further new login for an account that already has one is refused (NULL: the backend answers "not invited").
-- Adding a second login to an account needs an explicit linking flow from a session already signed in as that account.
--
-- identity_user_email(user_id) -> the account's own email (auth.users), or NULL when the user is not on the active allow-list.
-- The backend binds THIS email into the request user and the database token, never the email claim of the Auth0 token
-- (same as authenticate_api_key, migration 935).
-- Both service_role only. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.link_identity(p_provider text, p_sub text, p_email text, p_email_verified boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  found_user uuid;
BEGIN
  IF p_provider IS NULL OR p_sub IS NULL OR p_sub = '' THEN RETURN NULL; END IF;

  -- The login is already known: its owner never changes, whatever email it now carries.
  SELECT user_id INTO found_user FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub;
  IF found_user IS NOT NULL THEN RETURN found_user; END IF;

  -- A new login: link it to the existing user with the same email, but only for a verified email.
  IF NOT coalesce(p_email_verified, false) OR p_email IS NULL OR p_email = '' THEN RETURN NULL; END IF;
  -- The row lock serialises concurrent first sign-ins of one account, so two new logins cannot both see "no identity yet".
  SELECT id INTO found_user FROM auth.users WHERE lower(email) = lower(p_email) ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF found_user IS NULL THEN RETURN NULL; END IF;

  -- Only the first sign-in of an account links by email; an account that already has a login gets no further ones this way.
  IF EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = found_user) THEN RETURN NULL; END IF;

  INSERT INTO auth.external_identities (provider, provider_id, user_id) VALUES (p_provider, p_sub, found_user)
  ON CONFLICT (provider, provider_id) DO NOTHING;
  RETURN (SELECT user_id FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub);
END;
$$;

CREATE OR REPLACE FUNCTION public.identity_user_email(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT lower(u.email)::text
    FROM auth.users u
   WHERE u.id = p_user_id AND public.identity_is_authorized(u.id);
$$;

REVOKE ALL ON FUNCTION public.link_identity(text, text, text, boolean), public.identity_user_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_identity(text, text, text, boolean), public.identity_user_email(uuid) TO service_role;

-- ============================================================================
-- Migration 931: how an Auth0 login becomes an internal user
-- ============================================================================
-- Auth0 knows people by `sub` (auth0|abc, google-oauth2|123); the database knows them by uuid (auth.users.id, 59 foreign keys). The
-- backend verifies the Auth0 token, then asks these functions which internal user it is. PostgREST only exposes `public`, so the `auth`
-- tables are reached through these SECURITY DEFINER functions, callable by service_role ONLY (never by signed-in users or anon).
--   link_identity(provider, sub, email, email_verified)  -> user id, or NULL when this login belongs to nobody
--   provision_user(email, full_name)                      -> user id (created if new): the invite flow's first step
--   identity_is_authorized(user_id)                       -> is the user on the active allow-list (authorized_users)
-- A login is linked by email ONLY when Auth0 says the email is verified: an unverified address must never claim an existing account.
-- Idempotent.
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
  SELECT id INTO found_user FROM auth.users WHERE lower(email) = lower(p_email) ORDER BY created_at LIMIT 1;
  IF found_user IS NULL THEN RETURN NULL; END IF;

  INSERT INTO auth.external_identities (provider, provider_id, user_id) VALUES (p_provider, p_sub, found_user)
  ON CONFLICT (provider, provider_id) DO NOTHING;
  RETURN (SELECT user_id FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub);
END;
$$;

CREATE OR REPLACE FUNCTION public.provision_user(p_email text, p_full_name text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  user_id uuid;
BEGIN
  IF p_email IS NULL OR position('@' IN p_email) < 2 THEN RAISE EXCEPTION 'a valid email is required'; END IF;
  SELECT id INTO user_id FROM auth.users WHERE lower(email) = lower(p_email) ORDER BY created_at LIMIT 1;
  IF user_id IS NULL THEN
    INSERT INTO auth.users (email, raw_user_meta_data)
    VALUES (lower(p_email), CASE WHEN p_full_name IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('full_name', p_full_name) END)
    RETURNING id INTO user_id;
  END IF;
  RETURN user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.identity_is_authorized(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users u JOIN public.authorized_users a ON lower(a.email) = lower(u.email)
     WHERE u.id = p_user_id AND coalesce(a.is_active, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_identity(text, text, text, boolean), public.provision_user(text, text), public.identity_is_authorized(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_identity(text, text, text, boolean), public.provision_user(text, text), public.identity_is_authorized(uuid)
  TO service_role;

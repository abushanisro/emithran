-- ============================================================================
-- Migration 1001: a person's second sign-in method links by itself (decision 2026-11-12)
-- ============================================================================
-- People now sign in two ways: email + password (Auth0 database connection, sign-ups off: only accounts an admin creates) and Google
-- SSO (limited to the company domains by the Auth0 Action company-google-login). Under 947 only the first login of an account linked
-- by email; the second was refused ('link_required') until an operator linked it, so whoever used their other method was told
-- "not invited". Both connections are trusted to prove the email (the same allow-list 947 introduced), so a verified email from a
-- trusted connection now links to its invited account whether or not the account already has a login. Recorded as allowed
-- 'additional_login'. Unchanged: a known login keeps its owner; unverified email, untrusted connection and not invited are refused;
-- every decision is recorded; admin_link_identity stays for anything else.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE auth.link_events DROP CONSTRAINT IF EXISTS link_events_reason_check;
ALTER TABLE auth.link_events ADD CONSTRAINT link_events_reason_check
  CHECK (reason IN ('first_login', 'additional_login', 'admin_link', 'unverified', 'untrusted_connection', 'not_invited', 'link_required'));
ALTER TABLE auth.link_events DROP CONSTRAINT IF EXISTS link_events_check;
ALTER TABLE auth.link_events ADD CONSTRAINT link_events_check
  CHECK ((outcome = 'allowed') = (reason IN ('first_login', 'additional_login', 'admin_link')));

CREATE OR REPLACE FUNCTION public.link_identity(
  p_provider text, p_sub text, p_email text, p_email_verified boolean, p_connection text, p_trusted_connections text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  found_user uuid;
  refused text;
  reason text;
BEGIN
  IF p_provider IS NULL OR p_sub IS NULL OR p_sub = '' THEN RETURN NULL; END IF;

  -- The login is already known: its owner never changes, whatever email or connection it now carries.
  SELECT user_id INTO found_user FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub;
  IF found_user IS NOT NULL THEN RETURN found_user; END IF;

  IF NOT coalesce(p_email_verified, false) OR coalesce(p_email, '') = '' THEN
    refused := 'unverified';
  ELSIF coalesce(p_connection, '') = '' OR NOT (p_connection = ANY (coalesce(p_trusted_connections, '{}'::text[]))) THEN
    refused := 'untrusted_connection';
  ELSE
    -- The row lock serialises concurrent sign-ins of one account.
    SELECT id INTO found_user FROM auth.users WHERE lower(email) = lower(p_email) ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF found_user IS NULL THEN refused := 'not_invited'; END IF;
  END IF;

  IF refused IS NOT NULL THEN
    INSERT INTO auth.link_events (provider, provider_id, connection, email, user_id, outcome, reason)
    VALUES (p_provider, p_sub, nullif(p_connection, ''), nullif(p_email, ''), found_user, 'denied', refused);
    RETURN NULL;
  END IF;

  reason := CASE WHEN EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = found_user) THEN 'additional_login' ELSE 'first_login' END;
  INSERT INTO auth.external_identities (provider, provider_id, user_id) VALUES (p_provider, p_sub, found_user)
  ON CONFLICT (provider, provider_id) DO NOTHING;
  SELECT user_id INTO found_user FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub;
  INSERT INTO auth.link_events (provider, provider_id, connection, email, user_id, outcome, reason)
  VALUES (p_provider, p_sub, p_connection, p_email, found_user, 'allowed', reason);
  RETURN found_user;
END;
$$;

REVOKE ALL ON FUNCTION public.link_identity(text, text, text, boolean, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_identity(text, text, text, boolean, text, text[]) TO service_role;

NOTIFY pgrst, 'reload schema';

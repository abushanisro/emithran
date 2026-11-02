-- ============================================================================
-- Migration 947: a new login links by email only from a trusted Auth0 connection; every link decision is audited
-- ============================================================================
-- 938 linked the first verified login of an invited account whatever Auth0 connection it came from. A connection that asserts
-- email_verified for an address the caller does not own (a social or passwordless login enabled by mistake) could then claim
-- an invited account before its owner signs in. Decision D3: only the company SSO connection and the Auth0 database connection
-- (sign-ups off) may link. The allow-list is backend configuration (AUTH0_TRUSTED_CONNECTIONS), passed in by the caller with the
-- connection the login came from (the post-login Action's namespaced `connection` claim); the decision is made here.
--
-- link_identity(provider, sub, email, email_verified, connection, trusted_connections) -> user id, or NULL:
--   1. a known (provider, sub) resolves to its owner, whatever the connection (unchanged, not audited: it links nothing);
--   2. unverified (or no) email                                   -> NULL, denied 'unverified';
--   3. connection not in the allow-list (or missing)              -> NULL, denied 'untrusted_connection';
--   4. no account with that email                                 -> NULL, denied 'not_invited';
--   5. the account already has a login                            -> NULL, denied 'link_required' (an admin links it);
--   6. otherwise the login is stored                              -> user id, allowed 'first_login'.
-- The 4-argument link_identity is dropped, so no caller can skip the allow-list.
--
-- admin_link_identity(user_id, provider, sub, actor): the explicit way to add another login to an existing account (operator, as
-- service_role or the database owner). Refuses a login that belongs to someone else; audited as allowed 'admin_link' with the actor.
--
-- auth.link_events: one row per link decision (allowed and denied). In the auth schema, which the data API does not expose; row-level
-- security on and no grant to any API role: only these functions write it, operators read it as the database owner.
-- Nothing is mailed to the account when a login is added: there is no transactional mail service to reuse (follow-up).
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth.link_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  provider    text NOT NULL,
  provider_id text NOT NULL,                       -- the Auth0 `sub`
  connection  text,                                -- the Auth0 connection the login came from; NULL for an admin link
  email       text,                                -- the email the login presented (as presented: it may not be the caller's)
  user_id     uuid,                                -- the account linked, or the one a refused login asked for; no foreign key: the record outlives the account
  outcome     text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  reason      text NOT NULL CHECK (reason IN ('first_login', 'admin_link', 'unverified', 'untrusted_connection', 'not_invited', 'link_required')),
  actor       text,                                -- who made an admin link
  CHECK ((outcome = 'allowed') = (reason IN ('first_login', 'admin_link'))),
  CHECK ((reason = 'admin_link') = (actor IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS link_events_login ON auth.link_events (provider, provider_id, at DESC);
CREATE INDEX IF NOT EXISTS link_events_user ON auth.link_events (user_id, at DESC) WHERE user_id IS NOT NULL;
ALTER TABLE auth.link_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth.link_events FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.link_identity(text, text, text, boolean);

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
    -- The row lock serialises concurrent first sign-ins of one account, so two new logins cannot both see "no login yet".
    SELECT id INTO found_user FROM auth.users WHERE lower(email) = lower(p_email) ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF found_user IS NULL THEN
      refused := 'not_invited';
    ELSIF EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = found_user) THEN
      refused := 'link_required';
    END IF;
  END IF;

  IF refused IS NOT NULL THEN
    INSERT INTO auth.link_events (provider, provider_id, connection, email, user_id, outcome, reason)
    VALUES (p_provider, p_sub, nullif(p_connection, ''), nullif(p_email, ''), found_user, 'denied', refused);
    RETURN NULL;
  END IF;

  INSERT INTO auth.external_identities (provider, provider_id, user_id) VALUES (p_provider, p_sub, found_user)
  ON CONFLICT (provider, provider_id) DO NOTHING;
  SELECT user_id INTO found_user FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub;
  INSERT INTO auth.link_events (provider, provider_id, connection, email, user_id, outcome, reason)
  VALUES (p_provider, p_sub, p_connection, p_email, found_user, 'allowed', 'first_login');
  RETURN found_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_link_identity(p_user_id uuid, p_provider text, p_sub text, p_actor text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owner_id uuid;
BEGIN
  IF coalesce(p_provider, '') = '' OR coalesce(p_sub, '') = '' THEN RAISE EXCEPTION 'provider and sub are required'; END IF;
  IF coalesce(btrim(p_actor), '') = '' THEN RAISE EXCEPTION 'actor is required (who is making this link)'; END IF;
  PERFORM 1 FROM auth.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such user'; END IF;

  SELECT user_id INTO owner_id FROM auth.external_identities WHERE provider = p_provider AND provider_id = p_sub;
  IF owner_id = p_user_id THEN RETURN p_user_id; END IF;               -- already linked to this account: nothing to do
  IF owner_id IS NOT NULL THEN RAISE EXCEPTION 'this login already belongs to another user'; END IF;

  INSERT INTO auth.external_identities (provider, provider_id, user_id) VALUES (p_provider, p_sub, p_user_id);
  INSERT INTO auth.link_events (provider, provider_id, user_id, outcome, reason, actor)
  VALUES (p_provider, p_sub, p_user_id, 'allowed', 'admin_link', btrim(p_actor));
  RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_identity(text, text, text, boolean, text, text[]), public.admin_link_identity(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_identity(text, text, text, boolean, text, text[]), public.admin_link_identity(uuid, text, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

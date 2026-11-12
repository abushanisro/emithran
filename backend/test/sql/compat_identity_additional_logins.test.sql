-- Migration 1001 on top of 931 + 938 + 947: a person's second sign-in method (email + password and Google SSO) links by itself when it
-- is verified and comes from a trusted connection; everything else is refused as before, and every decision is recorded.
CREATE TABLE public.authorized_users (email text PRIMARY KEY, is_active boolean DEFAULT true);
\i /migrations/931_identity_functions.sql
\i /migrations/938_identity_link_first_login_only.sql
\i /migrations/947_identity_trusted_connections.sql
\i /migrations/1001_identity_link_additional_logins.sql
\i /migrations/1001_identity_link_additional_logins.sql

CREATE FUNCTION pg_temp.link(p_sub text, p_email text, p_verified boolean, p_connection text) RETURNS uuid
  LANGUAGE sql AS $$ SELECT public.link_identity('auth0', p_sub, p_email, p_verified, p_connection, ARRAY['google-oauth2', 'Username-Password-Authentication']) $$;
CREATE FUNCTION pg_temp.last_event(p_sub text) RETURNS text
  LANGUAGE sql AS $$ SELECT outcome || ' ' || reason FROM auth.link_events WHERE provider_id = p_sub ORDER BY id DESC LIMIT 1 $$;

DO $$
DECLARE a uuid; b uuid;
BEGIN
  a := public.provision_user('alice@emuski.com');
  b := public.provision_user('bob@emithran.com');

  -- first login: email + password
  ASSERT pg_temp.link('auth0|alice', 'alice@emuski.com', true, 'Username-Password-Authentication') = a, 'the first login links';
  ASSERT pg_temp.last_event('auth0|alice') = 'allowed first_login', 'recorded as the first login';

  -- second login of the same person: Google, verified, trusted -> links to the same account, recorded as an additional login
  ASSERT pg_temp.link('google-oauth2|alice', 'Alice@Emuski.com', true, 'google-oauth2') = a, 'the second trusted login links to the same account';
  ASSERT pg_temp.last_event('google-oauth2|alice') = 'allowed additional_login', 'recorded as an additional login';
  ASSERT (SELECT count(*) FROM auth.external_identities WHERE user_id = a) = 2, 'the account now has both logins';
  ASSERT pg_temp.link('auth0|alice', 'alice@emuski.com', true, 'Username-Password-Authentication') = a, 'both keep resolving';

  -- still refused: unverified, untrusted connection, not invited
  ASSERT pg_temp.link('google-oauth2|x1', 'alice@emuski.com', false, 'google-oauth2') IS NULL, 'an unverified email never links';
  ASSERT pg_temp.last_event('google-oauth2|x1') = 'denied unverified', 'recorded as unverified';
  ASSERT pg_temp.link('github|x2', 'alice@emuski.com', true, 'github') IS NULL, 'an untrusted connection never links';
  ASSERT pg_temp.last_event('github|x2') = 'denied untrusted_connection', 'recorded as untrusted';
  ASSERT pg_temp.link('google-oauth2|x3', 'stranger@gmail.com', true, 'google-oauth2') IS NULL, 'an email nobody invited never links';
  ASSERT pg_temp.last_event('google-oauth2|x3') = 'denied not_invited', 'recorded as not invited';
  ASSERT (SELECT count(*) FROM auth.external_identities WHERE user_id = a) = 2, 'refusals store nothing';

  -- a login keeps its owner: Alice's Google login presenting Bob's email still signs in as Alice
  ASSERT pg_temp.link('google-oauth2|alice', 'bob@emithran.com', true, 'google-oauth2') = a, 'a known login never moves to another account';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = b), 'Bob gained no login';

  -- the admin path still works, and the audit table accepts the new reason only for allowed links
  ASSERT public.admin_link_identity(b, 'auth0', 'okta|bob', 'ops@example.com') = b, 'an operator can still link a login';
  BEGIN
    INSERT INTO auth.link_events (provider, provider_id, outcome, reason) VALUES ('auth0', 'x', 'denied', 'additional_login');
    RAISE EXCEPTION 'a denied additional_login was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

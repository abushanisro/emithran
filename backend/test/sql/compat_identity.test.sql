-- Migrations 931 + 938 + 947 on a bare Postgres with 930: Auth0 logins map to internal users safely.
CREATE TABLE public.authorized_users (email text PRIMARY KEY, is_active boolean DEFAULT true);
\i /migrations/931_identity_functions.sql
\i /migrations/931_identity_functions.sql
\i /migrations/938_identity_link_first_login_only.sql
\i /migrations/938_identity_link_first_login_only.sql
\i /migrations/947_identity_trusted_connections.sql
\i /migrations/947_identity_trusted_connections.sql

-- link(sub, email, verified[, connection]): a sign-in through the backend, whose allow-list (AUTH0_TRUSTED_CONNECTIONS) is these two
CREATE FUNCTION pg_temp.link(p_sub text, p_email text, p_verified boolean, p_connection text DEFAULT 'company-sso') RETURNS uuid
  LANGUAGE sql AS $$ SELECT public.link_identity('auth0', p_sub, p_email, p_verified, p_connection, ARRAY['company-sso', 'Username-Password-Authentication']) $$;

DO $$
DECLARE a uuid; a_again uuid; linked uuid; other uuid; carol uuid; dave uuid;
BEGIN
  ASSERT to_regprocedure('public.link_identity(text,text,text,boolean)') IS NULL, 'the link without an allow-list is gone';

  -- provisioning is idempotent and case-insensitive
  a := public.provision_user('Alice@Example.com', 'Alice A');
  a_again := public.provision_user('alice@example.com');
  ASSERT a = a_again, 'the same email is the same user';
  ASSERT (SELECT email FROM auth.users WHERE id = a) = 'alice@example.com', 'emails are stored lower-case';
  ASSERT (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = a) = 'Alice A', 'the name is kept';

  -- a verified email from a trusted connection links a new login to the existing user, and that is audited
  linked := pg_temp.link('auth0|alice', 'ALICE@example.com', true);
  ASSERT linked = a, 'a verified email links to the existing user';
  ASSERT (SELECT row(outcome, reason, user_id, connection)::text FROM auth.link_events WHERE provider_id = 'auth0|alice')
       = row('allowed', 'first_login', a, 'company-sso')::text, 'the link is recorded as allowed';
  -- and the login is then known by sub alone, even if the email or the connection changed or is missing
  ASSERT pg_temp.link('auth0|alice', NULL, NULL, NULL) = a, 'a known login needs no email or connection';
  ASSERT pg_temp.link('auth0|alice', 'someone-else@example.com', true, 'google-oauth2') = a, 'a known login keeps its owner';
  ASSERT (SELECT count(*) FROM auth.link_events WHERE provider_id = 'auth0|alice') = 1, 'resolving a known login links nothing, records nothing';

  -- a second NEW login with the same verified email is refused: the account already has a login (938), nothing is stored
  ASSERT pg_temp.link('google-apps|99', 'alice@example.com', true) IS NULL, 'a second new login cannot take over a linked account';
  ASSERT (SELECT count(*) FROM auth.external_identities WHERE user_id = a) = 1, 'still one identity';
  ASSERT (SELECT row(outcome, reason, user_id)::text FROM auth.link_events WHERE provider_id = 'google-apps|99')
       = row('denied', 'link_required', a)::text, 'recorded as denied, link_required, naming the account';

  -- an UNVERIFIED email must never claim an account, and nothing is stored
  ASSERT pg_temp.link('auth0|attacker', 'alice@example.com', false) IS NULL, 'an unverified email links nothing';
  ASSERT pg_temp.link('auth0|attacker2', 'alice@example.com', NULL) IS NULL, 'an unknown verification state links nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE provider_id LIKE 'auth0|attacker%'), 'and nothing was stored';
  ASSERT (SELECT count(*) FROM auth.link_events WHERE provider_id LIKE 'auth0|attacker%' AND outcome = 'denied' AND reason = 'unverified') = 2,
    'both refusals recorded';

  -- an invited account with no login yet: unverified never links; an untrusted or missing connection never links; the first
  -- verified login from a trusted connection does (the database connection is trusted too)
  other := public.provision_user('bob@example.com');
  ASSERT pg_temp.link('auth0|bob-unverified', 'bob@example.com', false) IS NULL, 'unverified never links a fresh account';
  ASSERT pg_temp.link('google-oauth2|bob', 'bob@example.com', true, 'google-oauth2') IS NULL, 'a social connection never links';
  ASSERT pg_temp.link('email|bob', 'bob@example.com', true, NULL) IS NULL, 'a login without a connection never links';
  ASSERT pg_temp.link('email|bob2', 'bob@example.com', true, '') IS NULL, 'an empty connection never links';
  ASSERT public.link_identity('auth0', 'x|bob', 'bob@example.com', true, 'company-sso', NULL) IS NULL, 'no allow-list, nothing trusted';
  ASSERT public.link_identity('auth0', 'y|bob', 'bob@example.com', true, 'Company-SSO', ARRAY['company-sso']) IS NULL, 'connection names match exactly';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = other), 'nothing stored for bob';
  ASSERT (SELECT count(*) FROM auth.link_events WHERE provider_id IN ('google-oauth2|bob', 'email|bob', 'email|bob2', 'x|bob', 'y|bob')
           AND outcome = 'denied' AND reason = 'untrusted_connection') = 5, 'every untrusted connection recorded';
  ASSERT (SELECT connection FROM auth.link_events WHERE provider_id = 'google-oauth2|bob') = 'google-oauth2', 'with the connection it came from';
  ASSERT pg_temp.link('auth0|bob', 'Bob@example.com', true, 'Username-Password-Authentication') = other, 'first verified login from the database connection links';
  ASSERT pg_temp.link('google-apps|bob', 'bob@example.com', true) IS NULL, 'the second new login of bob is refused';

  -- a stranger (no such user) links nothing; bad input is refused quietly
  ASSERT pg_temp.link('auth0|nobody', 'nobody@example.com', true) IS NULL, 'no user, no link';
  ASSERT (SELECT row(outcome, reason)::text FROM auth.link_events WHERE provider_id = 'auth0|nobody') = row('denied', 'not_invited')::text, 'recorded as not invited';
  ASSERT pg_temp.link('', 'alice@example.com', true) IS NULL
     AND public.link_identity(NULL, 'x', 'alice@example.com', true, 'company-sso', ARRAY['company-sso']) IS NULL, 'empty sub or provider links nothing';

  -- the explicit way to add a second login: an operator, audited with who did it
  carol := public.provision_user('carol@example.com');
  ASSERT pg_temp.link('auth0|carol', 'carol@example.com', true) = carol, 'carol signs in once';
  ASSERT public.admin_link_identity(carol, 'auth0', 'google-apps|carol', 'ops@example.com') = carol, 'an operator links her second login';
  ASSERT pg_temp.link('google-apps|carol', 'carol@example.com', true) = carol, 'which then resolves';
  ASSERT (SELECT row(outcome, reason, user_id, actor)::text FROM auth.link_events WHERE provider_id = 'google-apps|carol')
       = row('allowed', 'admin_link', carol, 'ops@example.com')::text, 'recorded with the actor';
  ASSERT public.admin_link_identity(carol, 'auth0', 'google-apps|carol', 'ops@example.com') = carol, 'linking it again is a no-op';
  ASSERT (SELECT count(*) FROM auth.link_events WHERE provider_id = 'google-apps|carol') = 1, 'and records nothing new';
  dave := public.provision_user('dave@example.com');
  BEGIN PERFORM public.admin_link_identity(dave, 'auth0', 'auth0|carol', 'ops@example.com'); RAISE EXCEPTION 'moved a login to another user';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'this login already belongs to another user', SQLERRM; END;
  ASSERT (SELECT user_id FROM auth.external_identities WHERE provider_id = 'auth0|carol') = carol, 'carol keeps her login';
  BEGIN PERFORM public.admin_link_identity(dave, 'auth0', 'auth0|dave', ' '); RAISE EXCEPTION 'linked without an actor';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM LIKE 'actor is required%', SQLERRM; END;
  BEGIN PERFORM public.admin_link_identity(gen_random_uuid(), 'auth0', 'auth0|ghost', 'ops@example.com'); RAISE EXCEPTION 'linked to nobody';
  EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM = 'no such user', SQLERRM; END;
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = dave), 'nothing stored for dave';

  -- authorization is the allow-list, active entries only
  ASSERT NOT public.identity_is_authorized(a), 'not on the list yet';
  INSERT INTO public.authorized_users VALUES ('Alice@example.com', true);
  ASSERT public.identity_is_authorized(a), 'on the list (case-insensitive)';
  UPDATE public.authorized_users SET is_active = false;
  ASSERT NOT public.identity_is_authorized(a), 'inactive entries do not count';
  ASSERT NOT public.identity_is_authorized(gen_random_uuid()), 'unknown user';
  -- the account email (never a token claim) is handed back only for an authorised user
  ASSERT public.identity_user_email(a) IS NULL, 'no email for an inactive user';
  UPDATE public.authorized_users SET is_active = true;
  ASSERT public.identity_user_email(a) = 'alice@example.com', 'the account email of an authorised user';
  ASSERT public.identity_user_email(other) IS NULL, 'no email for a user not on the list';
  ASSERT public.identity_user_email(gen_random_uuid()) IS NULL, 'no email for an unknown user';

  BEGIN PERFORM public.provision_user('not-an-email'); RAISE EXCEPTION 'accepted a bad email'; EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'a valid email is required', 'bad email is refused with a clear message'; END;
END $$;

-- only the backend (service_role) may call them; no API role can reach the link record, and row-level security is on
DO $$
DECLARE fn text; r text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.link_identity(text,text,text,boolean,text,text[])', 'public.admin_link_identity(uuid,text,text,text)',
                            'public.provision_user(text,text)', 'public.identity_is_authorized(uuid)', 'public.identity_user_email(uuid)'] LOOP
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), fn || ' callable by service_role';
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), fn || ' not callable by signed-in users';
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), fn || ' not callable by anon';
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    ASSERT NOT has_table_privilege(r, 'auth.link_events', 'SELECT, INSERT, UPDATE, DELETE'), r || ' cannot touch auth.link_events';
  END LOOP;
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'auth.link_events'::regclass), 'row-level security is on';
END $$;

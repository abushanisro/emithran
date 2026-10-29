-- Migration 931 on a bare Postgres with 930: Auth0 logins map to internal users safely.
CREATE TABLE public.authorized_users (email text PRIMARY KEY, is_active boolean DEFAULT true);
\i /migrations/931_identity_functions.sql
\i /migrations/931_identity_functions.sql

DO $$
DECLARE a uuid; a_again uuid; linked uuid; relinked uuid; other uuid;
BEGIN
  -- provisioning is idempotent and case-insensitive
  a := public.provision_user('Alice@Example.com', 'Alice A');
  a_again := public.provision_user('alice@example.com');
  ASSERT a = a_again, 'the same email is the same user';
  ASSERT (SELECT email FROM auth.users WHERE id = a) = 'alice@example.com', 'emails are stored lower-case';
  ASSERT (SELECT raw_user_meta_data ->> 'full_name' FROM auth.users WHERE id = a) = 'Alice A', 'the name is kept';

  -- a verified email links a new login to the existing user
  linked := public.link_identity('auth0', 'auth0|alice', 'ALICE@example.com', true);
  ASSERT linked = a, 'a verified email links to the existing user';
  -- and the login is then known by sub alone, even if the email changed or is missing
  ASSERT public.link_identity('auth0', 'auth0|alice', NULL, NULL) = a, 'a known login needs no email';
  ASSERT public.link_identity('auth0', 'auth0|alice', 'someone-else@example.com', true) = a, 'a known login keeps its owner when the email changes';

  -- a second login (Google) of the same verified person joins the same user
  ASSERT public.link_identity('auth0', 'google-oauth2|99', 'alice@example.com', true) = a, 'a second verified login joins the same user';
  ASSERT (SELECT count(*) FROM auth.external_identities WHERE user_id = a) = 2, 'two identities, one user';

  -- an UNVERIFIED email must never claim an account, and nothing is stored
  ASSERT public.link_identity('auth0', 'auth0|attacker', 'alice@example.com', false) IS NULL, 'an unverified email links nothing';
  ASSERT public.link_identity('auth0', 'auth0|attacker2', 'alice@example.com', NULL) IS NULL, 'an unknown verification state links nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE provider_id LIKE 'auth0|attacker%'), 'and nothing was stored';

  -- a stranger (no such user) links nothing; bad input is refused quietly
  ASSERT public.link_identity('auth0', 'auth0|nobody', 'nobody@example.com', true) IS NULL, 'no user, no link';
  ASSERT public.link_identity('auth0', '', 'alice@example.com', true) IS NULL AND public.link_identity(NULL, 'x', 'alice@example.com', true) IS NULL, 'empty sub or provider links nothing';

  -- authorization is the allow-list, active entries only
  ASSERT NOT public.identity_is_authorized(a), 'not on the list yet';
  INSERT INTO public.authorized_users VALUES ('Alice@example.com', true);
  ASSERT public.identity_is_authorized(a), 'on the list (case-insensitive)';
  UPDATE public.authorized_users SET is_active = false;
  ASSERT NOT public.identity_is_authorized(a), 'inactive entries do not count';
  ASSERT NOT public.identity_is_authorized(gen_random_uuid()), 'unknown user';

  BEGIN PERFORM public.provision_user('not-an-email'); RAISE EXCEPTION 'accepted a bad email'; EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'a valid email is required', 'bad email is refused with a clear message'; END;
END $$;

-- only the backend (service_role) may call them
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.link_identity(text,text,text,boolean)', 'public.provision_user(text,text)', 'public.identity_is_authorized(uuid)'] LOOP
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), fn || ' callable by service_role';
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), fn || ' not callable by signed-in users';
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), fn || ' not callable by anon';
  END LOOP;
END $$;

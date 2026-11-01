-- Migrations 931 + 938 on a bare Postgres with 930: Auth0 logins map to internal users safely.
CREATE TABLE public.authorized_users (email text PRIMARY KEY, is_active boolean DEFAULT true);
\i /migrations/931_identity_functions.sql
\i /migrations/931_identity_functions.sql
\i /migrations/938_identity_link_first_login_only.sql
\i /migrations/938_identity_link_first_login_only.sql

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

  -- a second NEW login with the same verified email is refused: the account already has a login (938), nothing is stored
  ASSERT public.link_identity('auth0', 'google-oauth2|99', 'alice@example.com', true) IS NULL, 'a second new login cannot take over a linked account';
  ASSERT (SELECT count(*) FROM auth.external_identities WHERE user_id = a) = 1, 'still one identity';
  ASSERT public.link_identity('auth0', 'auth0|alice', 'alice@example.com', true) = a, 'the known login still resolves';

  -- an UNVERIFIED email must never claim an account, and nothing is stored
  ASSERT public.link_identity('auth0', 'auth0|attacker', 'alice@example.com', false) IS NULL, 'an unverified email links nothing';
  ASSERT public.link_identity('auth0', 'auth0|attacker2', 'alice@example.com', NULL) IS NULL, 'an unknown verification state links nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE provider_id LIKE 'auth0|attacker%'), 'and nothing was stored';
  -- also for an invited account that has no login yet: unverified never links, the first verified login does
  other := public.provision_user('bob@example.com');
  ASSERT public.link_identity('auth0', 'auth0|bob-unverified', 'bob@example.com', false) IS NULL, 'unverified never links a fresh account';
  ASSERT NOT EXISTS (SELECT 1 FROM auth.external_identities WHERE user_id = other), 'nothing stored for bob';
  ASSERT public.link_identity('auth0', 'auth0|bob', 'Bob@example.com', true) = other, 'first verified login of an invited account links';
  ASSERT public.link_identity('auth0', 'google-oauth2|bob', 'bob@example.com', true) IS NULL, 'the second new login of bob is refused';

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
  -- the account email (never a token claim) is handed back only for an authorised user
  ASSERT public.identity_user_email(a) IS NULL, 'no email for an inactive user';
  UPDATE public.authorized_users SET is_active = true;
  ASSERT public.identity_user_email(a) = 'alice@example.com', 'the account email of an authorised user';
  ASSERT public.identity_user_email(other) IS NULL, 'no email for a user not on the list';
  ASSERT public.identity_user_email(gen_random_uuid()) IS NULL, 'no email for an unknown user';

  BEGIN PERFORM public.provision_user('not-an-email'); RAISE EXCEPTION 'accepted a bad email'; EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'a valid email is required', 'bad email is refused with a clear message'; END;
END $$;

-- only the backend (service_role) may call them
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.link_identity(text,text,text,boolean)', 'public.provision_user(text,text)', 'public.identity_is_authorized(uuid)', 'public.identity_user_email(uuid)'] LOOP
    ASSERT has_function_privilege('service_role', fn, 'EXECUTE'), fn || ' callable by service_role';
    ASSERT NOT has_function_privilege('authenticated', fn, 'EXECUTE'), fn || ' not callable by signed-in users';
    ASSERT NOT has_function_privilege('anon', fn, 'EXECUTE'), fn || ' not callable by anon';
  END LOOP;
END $$;

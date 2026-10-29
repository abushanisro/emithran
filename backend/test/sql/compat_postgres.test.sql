-- Migration 930 on a BARE Postgres (no Supabase stand-ins): the claims PostgREST sets drive auth.uid()/role()/jwt(), the roles exist,
-- and a policy written for Supabase works unchanged. Applying 930 a second time must change nothing.
\i /migrations/930_postgres_compat.sql

DO $$
BEGIN
  ASSERT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'), 'service_role bypasses RLS';
  ASSERT NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'authenticated'), 'authenticated does not';
  ASSERT (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')) = 4, 'four roles';
  ASSERT pg_has_role('authenticator', 'authenticated', 'MEMBER'), 'PostgREST can switch to authenticated';
  ASSERT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'authenticator') AND NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'authenticated'), 'only authenticator logs in';
END $$;

-- identity from claims
DO $$
BEGIN
  ASSERT auth.uid() IS NULL AND auth.role() IS NULL AND auth.jwt() IS NULL, 'no claims, no identity';
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"qa@example.com"}', true);
  ASSERT auth.uid() = '11111111-1111-1111-1111-111111111111'::uuid, 'uid from sub';
  ASSERT auth.role() = 'authenticated', 'role from claims';
  ASSERT auth.jwt() ->> 'email' = 'qa@example.com', 'jwt() exposes the claims';
END $$;

-- foreign keys to auth.users, and the identity map
INSERT INTO auth.users (id, email) VALUES ('11111111-1111-1111-1111-111111111111', 'a@example.com'), ('22222222-2222-2222-2222-222222222222', 'b@example.com');
INSERT INTO auth.external_identities (provider_id, user_id) VALUES ('auth0|aaa', '11111111-1111-1111-1111-111111111111');
CREATE TABLE public.notes (id serial PRIMARY KEY, owner uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE, body text);
INSERT INTO public.notes (owner, body) VALUES ('11111111-1111-1111-1111-111111111111', 'mine'), ('22222222-2222-2222-2222-222222222222', 'theirs');
DO $$
BEGIN
  BEGIN
    INSERT INTO auth.external_identities (provider_id, user_id) VALUES ('auth0|aaa', '22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'a second user took the same Auth0 login';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.notes (owner, body) VALUES (gen_random_uuid(), 'orphan');
    RAISE EXCEPTION 'a row pointed at a user that does not exist';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- a policy written exactly as the Supabase migrations write them
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_notes ON public.notes FOR SELECT TO authenticated USING (owner = auth.uid());
CREATE POLICY own_notes_anon ON public.notes FOR SELECT TO anon USING (false);
-- no explicit GRANT: migration 930's default privileges must make the table reachable (and keep it closed to anon)
-- and a SECURITY DEFINER helper reading auth.users, like is_user_authorized()
CREATE FUNCTION public.my_email() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT email FROM auth.users WHERE id = auth.uid() $$;

SET ROLE authenticator;   -- how PostgREST connects
SET ROLE authenticated;       -- as PostgREST does: authenticator, then the role named in the token
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.notes) = 1 AND (SELECT body FROM public.notes) = 'mine', 'a signed-in user sees only their own rows';
  ASSERT public.my_email() = 'a@example.com', 'a SECURITY DEFINER helper can read the directory for the caller';
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
DO $$ BEGIN ASSERT (SELECT body FROM public.notes) = 'theirs', 'the other user sees theirs'; END $$;
SELECT set_config('request.jwt.claims', '', false);
DO $$ BEGIN ASSERT (SELECT count(*) FROM public.notes) = 0, 'no identity, no rows'; END $$;

DO $$
BEGIN
  ASSERT has_table_privilege('authenticated', 'public.notes', 'SELECT') AND has_table_privilege('authenticated', 'public.notes', 'INSERT'), 'signed-in users get table access by default';
  ASSERT NOT has_table_privilege('authenticated', 'public.notes', 'TRUNCATE'), 'but never TRUNCATE';
  ASSERT NOT has_table_privilege('anon', 'public.notes', 'SELECT'), 'anon gets nothing by default';
  ASSERT has_function_privilege('authenticated', 'public.my_email()', 'EXECUTE') AND has_function_privilege('service_role', 'public.my_email()', 'EXECUTE'), 'functions: signed-in and service';
  ASSERT NOT has_function_privilege('anon', 'public.my_email()', 'EXECUTE'), 'functions: not anon, not PUBLIC';
END $$;

-- nobody but the backend reads the directory or the identity map directly
DO $$
BEGIN
  BEGIN PERFORM 1 FROM auth.users; RAISE EXCEPTION 'authenticated read auth.users'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM auth.external_identities; RAISE EXCEPTION 'authenticated read the identity map'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM 1 FROM auth.users; RAISE EXCEPTION 'anon read auth.users'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.notes; RAISE EXCEPTION 'anon read a table'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- the privileged backend client
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.notes) = 2, 'service_role bypasses RLS';
  ASSERT (SELECT count(*) FROM auth.external_identities) = 1, 'and manages the identity map';
END $$;
RESET ROLE;

-- idempotent: a second run changes nothing, and deleting a user cleans up their identity
\i /migrations/930_postgres_compat.sql
DELETE FROM auth.users WHERE id = '11111111-1111-1111-1111-111111111111';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM auth.external_identities) = 0, 'identities follow the user';
  ASSERT (SELECT count(*) FROM public.notes) = 1, 'and so do their rows';
END $$;

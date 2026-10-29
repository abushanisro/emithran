-- ============================================================================
-- Migration 930: make a plain PostgreSQL behave like the part of Supabase our schema relies on
-- ============================================================================
-- Moving off Supabase (Auth0 for login, PostgREST in front of a managed Postgres) must not change a single row-level security
-- policy: 498 of them call auth.uid(), 7 auth.role(), 4 auth.jwt(), and 59 foreign keys point at auth.users(id). This migration
-- provides exactly those pieces, reading the identity from the claims PostgREST puts in `request.jwt.claims`:
--   roles       anon, authenticated, service_role (bypasses RLS), authenticator (what PostgREST logs in as)
--   auth.users  the user directory: same uuid ids as always; filled by the backend when it provisions an Auth0 user
--   auth.external_identities   which Auth0 `sub` belongs to which user (a separate table: Supabase's own auth.identities differs)
--   auth.uid() / auth.jwt() / auth.role()   the three functions the policies use
-- Everything is created only if it does not already exist, so on a Supabase project (where all of it is provided, owned by
-- Supabase) this migration changes nothing. Idempotent.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    BEGIN
      CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    EXCEPTION WHEN insufficient_privilege THEN
      -- Some managed providers do not let their admin user grant BYPASSRLS. Without it the backend's privileged client would be
      -- subject to RLS, so say so loudly instead of continuing as if it worked.
      RAISE WARNING 'cannot create service_role with BYPASSRLS here: create it as a provider superuser, or the privileged backend client will be filtered by RLS';
      CREATE ROLE service_role NOLOGIN NOINHERIT;
    END;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- The user directory. Only the columns our code and policies read; a Supabase project already has the full table.
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Which external login belongs to which user. Written only by the backend (service role).
CREATE TABLE IF NOT EXISTS auth.external_identities (
  provider    text        NOT NULL DEFAULT 'auth0',
  provider_id text        NOT NULL,                       -- the Auth0 `sub`, e.g. auth0|abc123 or google-oauth2|1234
  user_id     uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX IF NOT EXISTS external_identities_user ON auth.external_identities (user_id);
ALTER TABLE auth.external_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth.external_identities, auth.users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.external_identities, auth.users TO service_role;
-- Policies and SECURITY DEFINER helpers read auth.users as the function owner; signed-in users only ever see it through them.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'uid') THEN
    -- The same definitions Supabase ships: PostgREST (and the backend, for its own queries) publish the verified token's claims as the
    -- setting request.jwt.claims; `sub` carries the internal user uuid.
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
    $f$;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'role') THEN
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
    $f$;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname = 'jwt') THEN
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
      SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
    $f$;
  END IF;
END
$$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;

-- PostgREST connects as `authenticator` and switches to the role named in the token. Created without a password: set one (or use
-- the provider's IAM login) outside this file, never in version control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
  GRANT anon, authenticated, service_role TO authenticator;
END
$$;

-- Privileges for objects created LATER. Supabase grants access automatically on every new object in `public`; a plain Postgres grants
-- nothing, so without this every table a future migration creates would be unreachable by the app. The posture is the one reached by
-- migrations 921/922, not Supabase's default: signed-in users and the backend get access (RLS then filters rows), `anon` gets none.
-- Objects that already exist are deliberately NOT touched here: their grants came with the baseline dump (or with their own
-- migration, e.g. audit_events and job_queue are closed to the API roles on purpose), and a blanket GRANT would re-open them.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
-- Postgres itself lets PUBLIC execute every new function. That is a GLOBAL default, so removing it takes the form WITHOUT `IN SCHEMA`
-- (the per-schema form, used in migration 921, only undoes per-schema grants and leaves PUBLIC able to execute).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

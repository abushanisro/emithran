-- The smallest stand-ins for what a Supabase project provides and the migrations assume. Not a schema copy: only what the
-- tests under test/sql need, so a test fails because of the migration and not because of a missing stub.
-- roles belong to the whole Postgres server, not one database, so create each only if an earlier test already did
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
-- auth.uid() reads the user the test says it is
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
-- auth.jwt() reads the claims the test says the caller has
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb) $$;
-- the organizations the current test user belongs to
CREATE FUNCTION public.current_user_org_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS
  $$ SELECT unnest(string_to_array(nullif(current_setting('test.org_ids', true), ''), ',')::uuid[]) $$;

CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.boms (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.bom_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid, organization_id uuid,
  file_3d_path text, file_2d_path text, file_dxf_path text
);

CREATE TABLE public.api_request_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now());
CREATE TABLE public.fx_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, base_currency text NOT NULL, quote_currency text NOT NULL,
  rate numeric NOT NULL, rate_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.cad_analysis_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bom_item_id uuid NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE public.cad_analysis_cache (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expires_at timestamp, last_accessed timestamp DEFAULT now());
-- the real one lives in migration 076
CREATE FUNCTION public.cleanup_cad_analysis_cache() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer; BEGIN
  DELETE FROM cad_analysis_cache WHERE expires_at < now() OR last_accessed < now() - interval '7 days'; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE TABLE public.organization_members (
  organization_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL DEFAULT 'active', role text NOT NULL DEFAULT 'member'
);

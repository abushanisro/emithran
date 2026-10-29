-- ============================================================================
-- Migration 922: the anonymous role gets no table, view or sequence access in `public`
-- ============================================================================
-- Supabase gives `anon` (the role of anyone holding the public API key, i.e. every visitor) ALL privileges on every table in
-- `public` and relies on row-level security as the only guard. That fails open wherever RLS is off (backup copies, lookup
-- tables) and on every view, because a view runs with its owner's rights and skips the RLS of the tables under it. A stage
-- audit found anon with full access on ~330 relations. This application never serves data to a visitor without a login (the
-- browser signs in first; the backend uses the service role), so anon gets nothing, and the API roles lose the privileges they
-- can never legitimately use (TRUNCATE, REFERENCES, TRIGGER). Signed-in users keep SELECT/INSERT/UPDATE/DELETE, still limited
-- by RLS. Idempotent.
-- ============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- tables and sequences created later
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon;
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'not allowed to change supabase_admin default privileges; re-run this migration after creating tables in the dashboard';
END
$$;

-- What is still exposed to signed-in users WITHOUT row-level security (shown as notices; fix each with RLS policies or a
-- REVOKE FROM authenticated, per table, by someone who knows what the table is for).
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
       AND has_table_privilege('authenticated', c.oid, 'SELECT')
     ORDER BY c.relname
  LOOP
    RAISE NOTICE 'no row-level security, readable by every signed-in user: public.%', t.relname;
  END LOOP;
END
$$;

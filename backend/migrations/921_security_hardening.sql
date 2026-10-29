-- ============================================================================
-- Migration 921: close the three database findings from the stage QA run
-- ============================================================================
--   DB-RLS-01  an authenticated user could insert THEMSELVES into another organization (organization_members)
--   DB-RLS-19  a visitor with no login could read user emails (authorized_users)
--   DB-RPC-02  a visitor with no login could run get_project_cost_analysis (and any other public function)
-- These live in the database, so the fixes are written to be correct whatever policies a project already carries: they remove
-- the dangerous ones by what they allow, not by name. Idempotent.
--
-- 1. organization_members: a membership is created only by the service role (the backend, after checking who may add whom).
--    No API role can insert, update or delete a row; users can read the memberships of organizations they belong to.
-- 2. authorized_users: no anonymous access at all; a signed-in user sees only their own row (matched on the email in the token).
-- 3. Functions: no function in `public` is callable without a login. Postgres grants EXECUTE to PUBLIC on every new function,
--    and a later GRANT TO authenticated does not take that away, which is how an anonymous caller reached them. Whatever
--    signed-in users and the backend could call keeps working; service-role-only functions stay service-role-only. Future
--    functions get the same default.
-- ============================================================================

-- 1. organization_members ------------------------------------------------------------------------------------------------
DO $$
DECLARE p record;
BEGIN
  IF to_regclass('public.organization_members') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.organization_members FROM PUBLIC, anon, authenticated;

  -- Drop every policy that lets an API role write, including FOR ALL ones (they also grant reads, which is re-created below).
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'organization_members' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.organization_members', p.policyname);
  END LOOP;

  DROP POLICY IF EXISTS members_read_own_organizations ON public.organization_members;
  CREATE POLICY members_read_own_organizations ON public.organization_members FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR organization_id IN (SELECT current_user_org_ids()));
END
$$;

-- 2. authorized_users ----------------------------------------------------------------------------------------------------
DO $$
DECLARE p record;
BEGIN
  IF to_regclass('public.authorized_users') IS NULL THEN RETURN; END IF;
  ALTER TABLE public.authorized_users ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.authorized_users FROM PUBLIC, anon;
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.authorized_users FROM authenticated;

  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'authorized_users'
              AND (roles && ARRAY['public', 'anon']::name[] OR cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL') OR qual = 'true')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.authorized_users', p.policyname);
  END LOOP;

  DROP POLICY IF EXISTS authorized_users_read_self ON public.authorized_users;
  CREATE POLICY authorized_users_read_self ON public.authorized_users FOR SELECT TO authenticated
    USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
END
$$;

-- 3. functions -----------------------------------------------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.oid::regprocedure AS signature
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') -- not owned by an extension
  LOOP
    -- Keep exactly what signed-in users and the backend can call today (a function that was service-role only stays that way),
    -- written as an explicit grant so removing PUBLIC below cannot take it away; then close it to everyone else.
    IF has_function_privilege('authenticated', f.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature);
    END IF;
    IF has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.signature);
  END LOOP;
END
$$;

-- functions created later (by the roles migrations and the dashboard run as)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
  END IF;
END
$$;

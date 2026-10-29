-- The three stage QA findings, reproduced in their vulnerable form first and then closed by migration 921 (run by the harness
-- BEFORE this file, so the vulnerable state is rebuilt here by hand and 921 is applied again, which also proves it is idempotent).
CREATE TABLE IF NOT EXISTS public.authorized_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL);
ALTER TABLE public.authorized_users ENABLE ROW LEVEL SECURITY;
INSERT INTO public.authorized_users (email) VALUES ('a@example.com'), ('b@example.com');
GRANT SELECT ON public.authorized_users TO anon, authenticated;
CREATE POLICY open_read ON public.authorized_users FOR SELECT TO public USING (true);

GRANT ALL ON public.organization_members TO authenticated;
CREATE POLICY anyone_can_join ON public.organization_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE FUNCTION public.get_project_cost_analysis(project_id_input uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.get_project_cost_analysis(uuid) TO authenticated;

\i /migrations/921_security_hardening.sql
\i /migrations/921_security_hardening.sql

DO $$
BEGIN
  -- DB-RPC-02
  ASSERT NOT has_function_privilege('anon', 'public.get_project_cost_analysis(uuid)', 'EXECUTE'), 'anon cannot run the cost analysis';
  ASSERT has_function_privilege('authenticated', 'public.get_project_cost_analysis(uuid)', 'EXECUTE'), 'signed-in users still can';
  ASSERT has_function_privilege('service_role', 'public.get_project_cost_analysis(uuid)', 'EXECUTE'), 'the backend still can';
  ASSERT NOT has_function_privilege('anon', 'public.claim_next_job(text, integer)', 'EXECUTE'), 'other functions are closed too';
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_next_job(text, integer)', 'EXECUTE'), 'a service-role-only function does not become callable by signed-in users';
  ASSERT has_function_privilege('service_role', 'public.claim_next_job(text, integer)', 'EXECUTE'), 'and the backend keeps it';
  -- DB-RLS-01: no API role may write memberships, even with the permissive policy that used to exist
  ASSERT NOT has_table_privilege('authenticated', 'public.organization_members', 'INSERT'), 'no insert grant';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'organization_members' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')), 'no write policy';
  -- DB-RLS-19
  ASSERT NOT has_table_privilege('anon', 'public.authorized_users', 'SELECT'), 'anon cannot read authorized_users';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'authorized_users' AND (roles && ARRAY['public', 'anon']::name[] OR qual = 'true')), 'no open policy';
END
$$;

-- behaviour, as the roles: a signed-in user cannot add themselves to an organization and sees only their own authorized row
SET ROLE authenticated;
SELECT set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO public.organization_members (organization_id, user_id) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
    RAISE EXCEPTION 'self-join was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.authorized_users;
    RAISE EXCEPTION 'anonymous read was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

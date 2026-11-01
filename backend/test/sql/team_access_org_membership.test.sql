-- 939: a project_team_members row grants project and team access only while its user is an active member of the project's
-- organization; current_user_org_ids() gets a fixed search_path. The tables carry only the columns 562 and 939 rely on.
ALTER TABLE public.projects ADD COLUMN organization_id uuid;
CREATE TABLE public.project_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id), user_id text NOT NULL, role text NOT NULL
);
-- stand-in for migration 019: every test caller is on the allow-list
CREATE FUNCTION public.is_user_authorized() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_team_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects, public.project_team_members TO authenticated;

INSERT INTO public.projects (id, organization_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002');
-- user u is a project_manager on the team of A's project
INSERT INTO public.project_team_members (project_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'cccccccc-0000-4000-8000-00000000000c', 'project_manager');

\i /migrations/562_fix_project_team_members_rls_recursion.sql
\i /migrations/939_team_access_requires_org_membership.sql
\i /migrations/939_team_access_requires_org_membership.sql

DO $$
BEGIN
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = 'public.current_user_org_ids()'::regprocedure) @> ARRAY['search_path=public, pg_temp'],
    'current_user_org_ids has a fixed search_path';
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = 'public.current_user_team_project_ids()'::regprocedure) @> ARRAY['search_path=public, pg_temp'],
    'the team helpers too';
END $$;

SET ROLE authenticated;
SELECT set_config('test.uid', 'cccccccc-0000-4000-8000-00000000000c', false);

-- still an active member of A: the project and its team are visible, the team can be managed
SELECT set_config('test.org_ids', 'aaaaaaaa-0000-4000-8000-000000000001', false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.projects) = 1, 'a current member sees the project';
  ASSERT (SELECT count(*) FROM public.project_team_members) = 1, 'and its team';
END $$;

-- removed from A (now only in B): the leftover team row grants nothing on A's project
SELECT set_config('test.org_ids', 'bbbbbbbb-0000-4000-8000-000000000002', false);
DO $$
DECLARE n integer;
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.projects WHERE id = '00000000-0000-4000-8000-0000000000a1'), 'a removed member no longer sees the project';
  ASSERT (SELECT count(*) FROM public.projects) = 1, 'only the project of the organization they are in';
  ASSERT (SELECT count(*) FROM public.project_team_members) = 0, 'nor its team';
  UPDATE public.project_team_members SET role = 'owner' WHERE project_id = '00000000-0000-4000-8000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'nor can manage it';
END $$;

-- in no organization at all: nothing
SELECT set_config('test.org_ids', '', false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.projects) = 0, 'no organization, no projects';
  ASSERT (SELECT count(*) FROM public.project_team_members) = 0, 'and no teams';
END $$;
RESET ROLE;

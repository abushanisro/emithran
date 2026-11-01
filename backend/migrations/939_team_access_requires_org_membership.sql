-- ============================================================================
-- Migration 939: project team access requires CURRENT membership of the project's organization
-- ============================================================================
-- Migration 562 lets a person see a project (org_select_projects) and its team (org_select_project_team_members /
-- org_manage_project_team_members) through a project_team_members row alone. A person removed from the organization (or added
-- to a team while never a member, which the backend no longer allows) kept that access through a leftover team row. The two
-- helpers those policies use now count a team row only while its user is an active member of the project's organization, so
-- the policies themselves stay as they are.
--
-- Also: current_user_org_ids() (migration 541) is SECURITY DEFINER without a fixed search_path; pin it like every other
-- definer function (931, 932, 935).
-- Idempotent.
-- ============================================================================

ALTER FUNCTION public.current_user_org_ids() SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.current_user_team_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.project_id
    FROM public.project_team_members t
    JOIN public.projects p ON p.id = t.project_id
   WHERE t.user_id::uuid = auth.uid()
     AND p.organization_id IN (SELECT public.current_user_org_ids());
$$;

CREATE OR REPLACE FUNCTION public.current_user_managed_team_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.project_id
    FROM public.project_team_members t
    JOIN public.projects p ON p.id = t.project_id
   WHERE t.user_id::uuid = auth.uid()
     AND t.role IN ('owner', 'admin', 'project_manager')
     AND p.organization_id IN (SELECT public.current_user_org_ids());
$$;

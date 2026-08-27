-- ============================================================================
-- Migration 562: Fix infinite recursion in project_team_members RLS policies
--
-- Migration 555 introduced two policies on project_team_members
-- (org_select_project_team_members, org_manage_project_team_members) whose
-- USING clauses each contain a subquery that selects FROM
-- project_team_members itself. A policy that queries its own table is
-- self-referencing: Postgres must re-apply the same policy to evaluate the
-- subquery, which re-triggers the subquery, forever — "infinite recursion
-- detected in policy for relation project_team_members". This also broke
-- projects.org_select_projects (555), since its team-member carve-out does
-- `EXISTS (SELECT 1 FROM project_team_members ...)`, which now recurses
-- through project_team_members' own broken policy.
--
-- Fix follows the existing established pattern (current_user_org_ids(),
-- migration 541 / is_user_authorized(), migration 019): a SECURITY DEFINER
-- helper function runs as the table owner, which is exempt from RLS by
-- default (no FORCE ROW LEVEL SECURITY on project_team_members), so calling
-- it from inside a policy does not re-trigger that table's own RLS. Two
-- helpers are needed: current_user_team_project_ids() for "is a member at
-- all" (used by projects' and project_team_members' SELECT policies) and
-- current_user_managed_team_project_ids() for the role-gated "can manage
-- the team" carve-out project_team_members' ALL policy already had.
-- ============================================================================

CREATE OR REPLACE FUNCTION current_user_team_project_ids()
RETURNS SETOF UUID AS $$
  SELECT project_id
  FROM project_team_members
  WHERE user_id::uuid = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_user_managed_team_project_ids()
RETURNS SETOF UUID AS $$
  SELECT project_id
  FROM project_team_members
  WHERE user_id::uuid = auth.uid()
  AND role IN ('owner', 'admin', 'project_manager');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── projects: replace the self-recursing EXISTS with the helper ───────────

DROP POLICY IF EXISTS "org_select_projects" ON projects;

CREATE POLICY "org_select_projects" ON projects FOR SELECT
    USING (
        is_user_authorized() AND (
            organization_id IN (SELECT current_user_org_ids())
            OR id IN (SELECT current_user_team_project_ids())
        )
    );

-- ── project_team_members: same fix for its own two policies ───────────────

DROP POLICY IF EXISTS "org_select_project_team_members" ON project_team_members;
DROP POLICY IF EXISTS "org_manage_project_team_members" ON project_team_members;

CREATE POLICY "org_select_project_team_members" ON project_team_members
    FOR SELECT USING (
        project_id IN (
            SELECT p.id FROM projects p
            WHERE p.organization_id IN (SELECT current_user_org_ids())
        )
        OR project_id IN (SELECT current_user_team_project_ids())
    );

CREATE POLICY "org_manage_project_team_members" ON project_team_members
    FOR ALL USING (
        project_id IN (
            SELECT p.id FROM projects p
            WHERE p.organization_id IN (SELECT current_user_org_ids())
        )
        OR project_id IN (SELECT current_user_managed_team_project_ids())
    );

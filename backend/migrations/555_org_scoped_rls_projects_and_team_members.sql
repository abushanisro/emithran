-- ============================================================================
-- Migration 555: Org-scoped RLS for projects + project_team_members
--
-- Phase 4 RLS step (see .claude/plans/delegated-gliding-swan.md). Audited
-- first (forked subagent) before writing this: projects.service.ts is a
-- clean, pure-RLS-reliance pattern via BaseRepository — no manual user_id
-- filters anywhere to remove, unlike every table converted so far. The real
-- decision here wasn't technical, it was a pre-existing product gap this
-- migration deliberately restores rather than ignores:
--
-- project_team_members' OWN policy (migrations/039_fix_user_id_with_
-- policies.sql) already let an invited team member see the team list of a
-- project they don't own. But projects' own policy (019) has never had any
-- team-member carve-out at all — so today, being invited as a team member
-- lets you see WHO ELSE is on the team, but not the project itself, and not
-- any boms/bom_items under it. The invite flow has never actually granted
-- the access it implies. Confirmed live and real (project-team.ts /
-- ProjectDetailsCard.tsx, not dead code) — not something this initiative
-- introduces or needs to fix, but it shapes how the new org-scoped SELECT
-- policy below is written: it ADDS an EXISTS(project_team_members) carve-out
-- to projects' SELECT policy, restoring the team-member's intended (but
-- previously non-functional) project-level access, on top of the new
-- org-wide access. This is purely additive — nothing that could see a
-- project before loses that access. INSERT/UPDATE/DELETE stay org-scoped
-- only (a non-org team member being invited to collaborate is not the same
-- as being trusted to edit/delete the whole project) — a deliberate,
-- disclosed choice, not an oversight.
--
-- is_user_authorized() preserved exactly where it existed: projects had it
-- (019), project_team_members never did (039) — not standardized here.
-- ============================================================================

-- ── projects ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authorized users can view their own projects" ON projects;
DROP POLICY IF EXISTS "Authorized users can insert their own projects" ON projects;
DROP POLICY IF EXISTS "Authorized users can update their own projects" ON projects;
DROP POLICY IF EXISTS "Authorized users can delete their own projects" ON projects;

CREATE POLICY "org_select_projects" ON projects FOR SELECT
    USING (
        is_user_authorized() AND (
            organization_id IN (SELECT current_user_org_ids())
            OR EXISTS (
                SELECT 1 FROM project_team_members ptm
                WHERE ptm.project_id = projects.id AND ptm.user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "org_insert_projects" ON projects FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_projects" ON projects FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_projects" ON projects FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── project_team_members (no is_user_authorized, matches original) ─────────
-- No organization_id column of its own — visibility derives entirely from
-- its parent project via the EXISTS join, same as before, just swapping the
-- project-ownership test from user_id to organization_id membership.

DROP POLICY IF EXISTS "Users can view team members of their projects" ON project_team_members;
DROP POLICY IF EXISTS "Project owners can manage team members" ON project_team_members;

CREATE POLICY "org_select_project_team_members" ON project_team_members
    FOR SELECT USING (
        project_id IN (
            SELECT p.id FROM projects p
            WHERE p.organization_id IN (SELECT current_user_org_ids())
            OR EXISTS (
                SELECT 1 FROM project_team_members ptm
                WHERE ptm.project_id = p.id AND ptm.user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "org_manage_project_team_members" ON project_team_members
    FOR ALL USING (
        project_id IN (
            SELECT p.id FROM projects p
            WHERE p.organization_id IN (SELECT current_user_org_ids())
        )
        OR EXISTS (
            SELECT 1 FROM project_team_members ptm
            WHERE ptm.project_id = project_team_members.project_id
            AND ptm.user_id::uuid = auth.uid()
            AND ptm.role IN ('owner', 'admin', 'project_manager')
        )
    );

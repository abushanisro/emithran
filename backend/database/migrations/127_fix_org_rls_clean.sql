-- Migration 127: Drop all org/workspace policies and recreate with simple non-recursive rules.
-- Run this in the Supabase SQL editor.
-- The frontend queries Supabase directly (no NestJS backend for org), so RLS is the only guard.

-- ============================================================
-- DROP ALL EXISTING POLICIES (clean slate)
-- ============================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT policyname, tablename
        FROM pg_policies
        WHERE tablename IN ('organizations', 'organization_members', 'workspaces')
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- ============================================================
-- ORGANIZATIONS — owner-only, no cross-table reference
-- ============================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Owner can do everything with their own org
CREATE POLICY "org_owner_all" ON organizations
    FOR ALL
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- ORGANIZATION MEMBERS — each user sees/manages their own row; owner manages all
-- ============================================================
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Each user can read their own membership row
CREATE POLICY "member_read_own" ON organization_members
    FOR SELECT
    USING (user_id = auth.uid());

-- Anyone can insert a row where they are the member (joining)
CREATE POLICY "member_insert_own" ON organization_members
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Only org owners can insert invited rows (invited_email set, user_id null)
CREATE POLICY "owner_insert_invited" ON organization_members
    FOR INSERT
    WITH CHECK (
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    );

-- Org owners can update/delete any member row in their org
CREATE POLICY "owner_manage_members" ON organization_members
    FOR ALL
    USING (
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    );

-- ============================================================
-- WORKSPACES — owner-only (org owner manages all workspaces)
-- ============================================================
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- Org owner can do everything with workspaces in their org
CREATE POLICY "owner_manage_workspaces" ON workspaces
    FOR ALL
    USING (
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    )
    WITH CHECK (
        organization_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid())
    );

-- Members can read workspaces of orgs they belong to
CREATE POLICY "member_read_workspaces" ON workspaces
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
    );

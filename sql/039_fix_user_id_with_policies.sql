-- Fix user_id foreign key constraint by handling RLS policies
-- Migration: 039_fix_user_id_with_policies.sql

-- Step 1: Drop existing RLS policies that depend on user_id column
DROP POLICY IF EXISTS "Users can view team members of their projects" ON project_team_members;
DROP POLICY IF EXISTS "Project owners can manage team members" ON project_team_members;

-- Step 2: Drop the existing foreign key constraint
ALTER TABLE project_team_members 
DROP CONSTRAINT IF EXISTS project_team_members_user_id_fkey;

-- Step 3: Alter column type (should work now that policies are dropped)
ALTER TABLE project_team_members 
ALTER COLUMN user_id TYPE TEXT;

-- Step 4: Recreate the RLS policies with same logic
CREATE POLICY "Users can view team members of their projects" ON project_team_members
    FOR SELECT USING (
        project_id IN (
            SELECT p.id FROM projects p 
            WHERE p.user_id::uuid = auth.uid()
            OR EXISTS (
                SELECT 1 FROM project_team_members ptm 
                WHERE ptm.project_id = p.id 
                AND ptm.user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Project owners can manage team members" ON project_team_members
    FOR ALL USING (
        project_id IN (
            SELECT p.id FROM projects p 
            WHERE p.user_id::uuid = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM project_team_members ptm 
            WHERE ptm.project_id = project_team_members.project_id
            AND ptm.user_id::uuid = auth.uid()
            AND ptm.role IN ('owner', 'admin', 'project_manager')
        )
    );

-- Step 5: Add comments and index
COMMENT ON COLUMN project_team_members.user_id IS 'User ID from auth.users table or placeholder for pending invites';

CREATE INDEX IF NOT EXISTS idx_project_team_members_user_id_lookup 
ON project_team_members(user_id) WHERE user_id NOT LIKE 'pending-%';

COMMENT ON TABLE project_team_members IS 'Project team members with support for pending user invitations';
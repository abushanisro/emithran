-- Migration: Create project_team_members table
-- This enables proper team member management with role-based access

-- Create the project_team_members table
CREATE TABLE IF NOT EXISTS project_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, -- Can be actual user ID or placeholder for pending invites
    role TEXT NOT NULL CHECK (role IN (
        -- Legacy roles (backward compatibility)
        'owner', 'admin', 'member', 'viewer',
        -- Module-based manufacturing roles
        'project_manager', 'design_engineer', 'manufacturing_engineer',
        'procurement_manager', 'quality_engineer', 'finance_analyst'
    )),
    email TEXT, -- Optional: store email for pending invites
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_team_members_project_id ON project_team_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_team_members_user_id ON project_team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_team_members_role ON project_team_members(role);

-- Prevent duplicate team members per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_team_members_unique 
ON project_team_members(project_id, user_id);

-- Add RLS policies for security
ALTER TABLE project_team_members ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see team members of their projects
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

-- Policy: Project owners and admins can manage team members
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

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_project_team_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_team_members_updated_at_trigger
    BEFORE UPDATE ON project_team_members
    FOR EACH ROW
    EXECUTE FUNCTION update_project_team_members_updated_at();

-- Insert default project owner for existing projects (optional)
-- This ensures existing projects have an owner team member
INSERT INTO project_team_members (project_id, user_id, role)
SELECT 
    p.id,
    p.user_id,
    'owner'
FROM projects p
WHERE NOT EXISTS (
    SELECT 1 FROM project_team_members ptm 
    WHERE ptm.project_id = p.id 
    AND ptm.user_id = p.user_id
)
ON CONFLICT (project_id, user_id) DO NOTHING;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON project_team_members TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
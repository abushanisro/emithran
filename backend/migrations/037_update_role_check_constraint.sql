-- Update role check constraint to include new module-based roles
-- Migration: 037_update_role_check_constraint.sql

-- Drop the existing check constraint
ALTER TABLE project_team_members 
DROP CONSTRAINT IF EXISTS project_team_members_role_check;

-- Add the updated check constraint with all roles
ALTER TABLE project_team_members 
ADD CONSTRAINT project_team_members_role_check 
CHECK (role IN (
    -- Legacy roles (backward compatibility)
    'owner', 'admin', 'member', 'viewer',
    -- Module-based manufacturing roles
    'project_manager', 'design_engineer', 'manufacturing_engineer',
    'procurement_manager', 'quality_engineer', 'finance_analyst'
));

-- Add comment for documentation
COMMENT ON CONSTRAINT project_team_members_role_check ON project_team_members 
IS 'Ensures only valid manufacturing roles are allowed';
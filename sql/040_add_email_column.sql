-- Add email column to project_team_members table
-- Migration: 040_add_email_column.sql

-- Add email column if it doesn't exist
ALTER TABLE project_team_members 
ADD COLUMN IF NOT EXISTS email TEXT;

-- Add comment for documentation
COMMENT ON COLUMN project_team_members.email IS 'Email address for team member invitations (especially for pending users)';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_project_team_members_email 
ON project_team_members(email) WHERE email IS NOT NULL;
-- Fix user_id foreign key constraint to allow placeholder users
-- Migration: 038_fix_user_id_foreign_key.sql

-- Drop the existing foreign key constraint if it exists
ALTER TABLE project_team_members 
DROP CONSTRAINT IF EXISTS project_team_members_user_id_fkey;

-- Change user_id column to allow any text value (no foreign key constraint)
-- This allows both actual user IDs and placeholder IDs for pending invites
ALTER TABLE project_team_members 
ALTER COLUMN user_id TYPE TEXT;

-- Add comment for documentation
COMMENT ON COLUMN project_team_members.user_id IS 'User ID from auth.users table or placeholder for pending invites';

-- Add index for performance since we removed the foreign key
CREATE INDEX IF NOT EXISTS idx_project_team_members_user_id_lookup 
ON project_team_members(user_id) WHERE user_id NOT LIKE 'pending-%';

-- Add comment for the table
COMMENT ON TABLE project_team_members IS 'Project team members with support for pending user invitations';
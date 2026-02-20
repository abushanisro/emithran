-- Fix project_team_members table structure and trigger
-- Migration: 036_fix_project_team_members_trigger.sql

-- Ensure updated_at column exists
ALTER TABLE project_team_members 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS project_team_members_updated_at_trigger ON project_team_members;
DROP FUNCTION IF EXISTS update_project_team_members_updated_at();

-- Create the updated_at trigger function
CREATE OR REPLACE FUNCTION update_project_team_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
CREATE TRIGGER project_team_members_updated_at_trigger
    BEFORE UPDATE ON project_team_members
    FOR EACH ROW
    EXECUTE FUNCTION update_project_team_members_updated_at();

-- Update existing records to have updated_at value
UPDATE project_team_members 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN project_team_members.updated_at IS 'Automatically updated when row is modified';
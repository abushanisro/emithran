-- Ensure project summary columns exist and are properly configured
-- Migration: 041_ensure_project_summary_columns.sql

-- Add columns if they don't exist (safe operation)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimated_annual_volume INTEGER;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_bom_cost DECIMAL(12, 2);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS target_bom_cost_currency TEXT;

-- Add comments for documentation
COMMENT ON COLUMN projects.industry IS 'Industry sector for the project (e.g. Medical, Automotive, Aerospace)';
COMMENT ON COLUMN projects.estimated_annual_volume IS 'Expected annual production volume';
COMMENT ON COLUMN projects.target_bom_cost IS 'Target Bill of Materials cost';
COMMENT ON COLUMN projects.target_bom_cost_currency IS 'Currency for target BOM cost based on country (USD, INR, EUR, GBP)';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_industry ON projects(industry) WHERE industry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_volume_range ON projects(estimated_annual_volume) WHERE estimated_annual_volume IS NOT NULL;
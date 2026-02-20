-- ============================================================================
-- ADD PROJECT SUMMARY SNAPSHOT FIELDS
-- ============================================================================
-- Migration: 034_add_project_summary_fields.sql
-- Description: Add Industry, Estimated Annual Volume, Target BOM Cost to projects table
-- ============================================================================

-- Add project summary fields to projects table
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS industry TEXT,
ADD COLUMN IF NOT EXISTS estimated_annual_volume INTEGER,
ADD COLUMN IF NOT EXISTS target_bom_cost DECIMAL(12, 2),
ADD COLUMN IF NOT EXISTS target_bom_cost_currency TEXT;

-- Add comments for documentation
COMMENT ON COLUMN projects.industry IS 'Industry sector for the project (e.g. Medical, Automotive, Aerospace)';
COMMENT ON COLUMN projects.estimated_annual_volume IS 'Expected annual production volume';
COMMENT ON COLUMN projects.target_bom_cost IS 'Target Bill of Materials cost';
COMMENT ON COLUMN projects.target_bom_cost_currency IS 'Currency for target BOM cost (USD, INR, EUR, GBP)';

-- Add indexes for filtering and analysis
CREATE INDEX IF NOT EXISTS idx_projects_industry ON projects(industry) WHERE industry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_volume_range ON projects(estimated_annual_volume) WHERE estimated_annual_volume IS NOT NULL;
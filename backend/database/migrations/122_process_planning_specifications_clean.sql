-- Migration: Create process planning specifications table (Clean Version)
-- Version: 122
-- Purpose: Clean setup with proper IF NOT EXISTS handling

BEGIN;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view process planning specs for their projects" ON process_planning_specifications;
DROP POLICY IF EXISTS "Users can insert process planning specs for their projects" ON process_planning_specifications;
DROP POLICY IF EXISTS "Users can update process planning specs for their projects" ON process_planning_specifications;
DROP POLICY IF EXISTS "Users can delete process planning specs for their projects" ON process_planning_specifications;

-- Drop existing table and view if they exist
DROP VIEW IF EXISTS process_planning_with_bom_details;
DROP TABLE IF EXISTS process_planning_specifications;

-- Create process planning specifications table
CREATE TABLE process_planning_specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Essential Manufacturing Specifications Only
    tolerance_grade VARCHAR(50) DEFAULT 'IT8',
    surface_finish VARCHAR(100) DEFAULT 'Ra 3.2 μm',
    heat_treatment VARCHAR(100) DEFAULT 'As Required',
    hardness VARCHAR(50),
    
    -- Process Planning Specific Fields
    manufacturing_method VARCHAR(100),
    tooling_required TEXT,
    special_instructions TEXT,
    coating_specification VARCHAR(100),
    
    -- Audit and Security
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one specification per BOM item per project
    CONSTRAINT unique_bom_item_project UNIQUE (bom_item_id, project_id)
);

-- Add Row Level Security (RLS)
ALTER TABLE process_planning_specifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for process planning specifications
CREATE POLICY "Users can view process planning specs for their projects" 
ON process_planning_specifications FOR SELECT
USING (
    project_id IN (
        SELECT p.id FROM projects p
        LEFT JOIN project_team_members ptm ON p.id = ptm.project_id
        WHERE p.user_id::uuid = auth.uid() OR ptm.user_id::uuid = auth.uid()
    )
);

CREATE POLICY "Users can insert process planning specs for their projects" 
ON process_planning_specifications FOR INSERT
WITH CHECK (
    project_id IN (
        SELECT p.id FROM projects p
        LEFT JOIN project_team_members ptm ON p.id = ptm.project_id
        WHERE p.user_id::uuid = auth.uid() OR ptm.user_id::uuid = auth.uid()
    )
);

CREATE POLICY "Users can update process planning specs for their projects" 
ON process_planning_specifications FOR UPDATE
USING (
    project_id IN (
        SELECT p.id FROM projects p
        LEFT JOIN project_team_members ptm ON p.id = ptm.project_id
        WHERE p.user_id::uuid = auth.uid() OR ptm.user_id::uuid = auth.uid()
    )
);

CREATE POLICY "Users can delete process planning specs for their projects" 
ON process_planning_specifications FOR DELETE
USING (
    project_id IN (
        SELECT p.id FROM projects p
        LEFT JOIN project_team_members ptm ON p.id = ptm.project_id
        WHERE p.user_id::uuid = auth.uid() OR ptm.user_id::uuid = auth.uid()
    )
);

-- Create indexes for performance
CREATE INDEX idx_process_planning_specs_bom_item ON process_planning_specifications (bom_item_id);
CREATE INDEX idx_process_planning_specs_project ON process_planning_specifications (project_id);
CREATE INDEX idx_process_planning_specs_combined ON process_planning_specifications (project_id, bom_item_id);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_process_planning_specifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_process_planning_specifications_updated_at
    BEFORE UPDATE ON process_planning_specifications
    FOR EACH ROW
    EXECUTE FUNCTION update_process_planning_specifications_updated_at();

-- Create a view for easy querying with BOM item details
CREATE VIEW process_planning_with_bom_details AS
SELECT 
    pps.*,
    bi.name as bom_item_name,
    bi.part_number,
    bi.description as bom_item_description,
    bi.item_type,
    bi.material,
    bi.material_grade,
    bi.quantity,
    bi.annual_volume,
    bi.unit,
    bi.max_length,
    bi.max_width,
    bi.max_height,
    bi.weight,
    bi.unit_cost
FROM process_planning_specifications pps
JOIN bom_items bi ON pps.bom_item_id = bi.id;

COMMENT ON TABLE process_planning_specifications IS 'Manufacturing specifications for process planning - essential fields only';
COMMENT ON VIEW process_planning_with_bom_details IS 'Combined view of process planning specs with BOM item details';

COMMIT;
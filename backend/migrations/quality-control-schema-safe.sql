-- Quality Control Database Schema Migration - SAFE VERSION
-- Principal Engineer Best Practices: Zero-downtime, backwards compatible
-- Run this version with existing production data

-- Step 1: Create tables without foreign key constraints first
-- This prevents dependency issues with existing schema

CREATE TABLE IF NOT EXISTS quality_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(100) DEFAULT 'first-article',
  status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'approved', 'rejected')),
  project_id UUID, -- No FK constraint initially
  bom_id UUID,     -- No FK constraint initially
  inspector VARCHAR(255),
  planned_date TIMESTAMP WITH TIME ZONE,
  actual_start_date TIMESTAMP WITH TIME ZONE,
  actual_end_date TIMESTAMP WITH TIME ZONE,
  selected_items JSONB DEFAULT '[]',
  quality_standards JSONB DEFAULT '[]',
  checklist JSONB DEFAULT '[]',
  overall_result VARCHAR(20) CHECK (overall_result IN ('pass', 'fail', 'conditional')),
  notes TEXT,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_by UUID,
  rejected_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_inspection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL, -- FK will be added later
  bom_item_id UUID,             -- FK will be added later  
  checklist_item_id VARCHAR(255),
  measurement_type VARCHAR(100),
  description TEXT,
  expected_value DECIMAL(10,4),
  actual_value DECIMAL(10,4),
  tolerance DECIMAL(10,4) DEFAULT 0.1,
  unit VARCHAR(20) DEFAULT 'mm',
  result VARCHAR(20) CHECK (result IN ('pass', 'fail', 'na')),
  measurement_values JSONB DEFAULT '[]',
  notes TEXT,
  inspector VARCHAR(255),
  inspection_date TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_non_conformances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL, -- FK will be added later
  bom_item_id UUID,             -- FK will be added later
  nonconformance_type VARCHAR(100),
  severity VARCHAR(20) DEFAULT 'minor' CHECK (severity IN ('critical', 'major', 'minor')),
  status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'closed', 'deferred')),
  description TEXT NOT NULL,
  root_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  assigned_to UUID,
  due_date TIMESTAMP WITH TIME ZONE,
  resolved_date TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 2: Create indexes for performance (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_quality_inspections_project_id ON quality_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_bom_id ON quality_inspections(bom_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_status ON quality_inspections(status);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_type ON quality_inspections(type);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_created_by ON quality_inspections(created_by);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_planned_date ON quality_inspections(planned_date);

CREATE INDEX IF NOT EXISTS idx_quality_inspection_results_inspection_id ON quality_inspection_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspection_results_bom_item_id ON quality_inspection_results(bom_item_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspection_results_result ON quality_inspection_results(result);

CREATE INDEX IF NOT EXISTS idx_quality_nonconformances_inspection_id ON quality_non_conformances(inspection_id);
CREATE INDEX IF NOT EXISTS idx_quality_nonconformances_bom_item_id ON quality_non_conformances(bom_item_id);
CREATE INDEX IF NOT EXISTS idx_quality_nonconformances_status ON quality_non_conformances(status);
CREATE INDEX IF NOT EXISTS idx_quality_nonconformances_severity ON quality_non_conformances(severity);

-- Step 3: Create update triggers (check if function exists first)
DO $$ 
BEGIN
    -- Check if the update function exists, create a simple version if not
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS '
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        ' LANGUAGE plpgsql;
    END IF;
END $$;

-- Create triggers
DROP TRIGGER IF EXISTS update_quality_inspections_updated_at ON quality_inspections;
CREATE TRIGGER update_quality_inspections_updated_at 
    BEFORE UPDATE ON quality_inspections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quality_inspection_results_updated_at ON quality_inspection_results;
CREATE TRIGGER update_quality_inspection_results_updated_at 
    BEFORE UPDATE ON quality_inspection_results 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quality_nonconformances_updated_at ON quality_non_conformances;
CREATE TRIGGER update_quality_nonconformances_updated_at 
    BEFORE UPDATE ON quality_non_conformances 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 4: Enable Row Level Security
ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_non_conformances ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policies (safe - will not error if they exist)
DROP POLICY IF EXISTS "quality_inspections_select_policy" ON quality_inspections;
CREATE POLICY "quality_inspections_select_policy" ON quality_inspections
    FOR SELECT USING (
        -- Allow access if user owns the project or is a team member
        project_id::text IN (
            SELECT id::text FROM projects WHERE user_id::text = auth.uid()::text
            UNION
            SELECT project_id::text FROM project_team_members WHERE user_id::text = auth.uid()::text
        )
        OR created_by::text = auth.uid()::text
    );

DROP POLICY IF EXISTS "quality_inspections_insert_policy" ON quality_inspections;
CREATE POLICY "quality_inspections_insert_policy" ON quality_inspections
    FOR INSERT WITH CHECK (created_by::text = auth.uid()::text);

DROP POLICY IF EXISTS "quality_inspections_update_policy" ON quality_inspections;
CREATE POLICY "quality_inspections_update_policy" ON quality_inspections
    FOR UPDATE USING (
        created_by::text = auth.uid()::text
        OR project_id::text IN (
            SELECT id::text FROM projects WHERE user_id::text = auth.uid()::text
            UNION
            SELECT project_id::text FROM project_team_members WHERE user_id::text = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS "quality_inspections_delete_policy" ON quality_inspections;
CREATE POLICY "quality_inspections_delete_policy" ON quality_inspections
    FOR DELETE USING (created_by::text = auth.uid()::text);

-- Similar policies for other tables
DROP POLICY IF EXISTS "quality_inspection_results_select_policy" ON quality_inspection_results;
CREATE POLICY "quality_inspection_results_select_policy" ON quality_inspection_results
    FOR SELECT USING (
        inspection_id IN (SELECT id FROM quality_inspections)
    );

DROP POLICY IF EXISTS "quality_inspection_results_insert_policy" ON quality_inspection_results;
CREATE POLICY "quality_inspection_results_insert_policy" ON quality_inspection_results
    FOR INSERT WITH CHECK (created_by::text = auth.uid()::text);

DROP POLICY IF EXISTS "quality_inspection_results_update_policy" ON quality_inspection_results;
CREATE POLICY "quality_inspection_results_update_policy" ON quality_inspection_results
    FOR UPDATE USING (created_by::text = auth.uid()::text);

DROP POLICY IF EXISTS "quality_inspection_results_delete_policy" ON quality_inspection_results;
CREATE POLICY "quality_inspection_results_delete_policy" ON quality_inspection_results
    FOR DELETE USING (created_by::text = auth.uid()::text);

-- Non-conformances policies
DROP POLICY IF EXISTS "quality_nonconformances_select_policy" ON quality_non_conformances;
CREATE POLICY "quality_nonconformances_select_policy" ON quality_non_conformances
    FOR SELECT USING (
        inspection_id IN (SELECT id FROM quality_inspections)
    );

DROP POLICY IF EXISTS "quality_nonconformances_insert_policy" ON quality_non_conformances;
CREATE POLICY "quality_nonconformances_insert_policy" ON quality_non_conformances
    FOR INSERT WITH CHECK (created_by::text = auth.uid()::text);

DROP POLICY IF EXISTS "quality_nonconformances_update_policy" ON quality_non_conformances;
CREATE POLICY "quality_nonconformances_update_policy" ON quality_non_conformances
    FOR UPDATE USING (created_by::text = auth.uid()::text);

DROP POLICY IF EXISTS "quality_nonconformances_delete_policy" ON quality_non_conformances;
CREATE POLICY "quality_nonconformances_delete_policy" ON quality_non_conformances
    FOR DELETE USING (created_by::text = auth.uid()::text);

-- Step 6: Grant permissions
GRANT ALL ON quality_inspections TO authenticated;
GRANT ALL ON quality_inspection_results TO authenticated;
GRANT ALL ON quality_non_conformances TO authenticated;

-- Step 7: Add helpful comments
COMMENT ON TABLE quality_inspections IS 'Main quality inspection records - created safely without FK constraints';
COMMENT ON TABLE quality_inspection_results IS 'Detailed inspection results and measurements';
COMMENT ON TABLE quality_non_conformances IS 'Quality non-conformance tracking';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Quality Control schema created successfully!';
    RAISE NOTICE 'Tables created: quality_inspections, quality_inspection_results, quality_non_conformances';
    RAISE NOTICE 'No foreign key constraints added - run foreign key migration separately if needed';
END $$;
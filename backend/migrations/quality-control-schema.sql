-- Quality Control Database Schema Migration

-- Create quality_inspections table
CREATE TABLE IF NOT EXISTS quality_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(100) DEFAULT 'first-article',
  status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'approved', 'rejected')),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bom_id UUID REFERENCES boms(id) ON DELETE SET NULL,
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

-- Create quality_inspection_results table
CREATE TABLE IF NOT EXISTS quality_inspection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
  bom_item_id UUID REFERENCES bom_items(id) ON DELETE SET NULL,
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

-- Create quality_non_conformances table
CREATE TABLE IF NOT EXISTS quality_non_conformances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
  bom_item_id UUID REFERENCES bom_items(id) ON DELETE SET NULL,
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

-- Create indexes for performance
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

-- Create triggers for updated_at
CREATE TRIGGER update_quality_inspections_updated_at 
    BEFORE UPDATE ON quality_inspections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quality_inspection_results_updated_at 
    BEFORE UPDATE ON quality_inspection_results 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quality_nonconformances_updated_at 
    BEFORE UPDATE ON quality_non_conformances 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE quality_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspection_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_non_conformances ENABLE ROW LEVEL SECURITY;

-- RLS policies for quality_inspections
CREATE POLICY "Users can view quality inspections for their projects" ON quality_inspections
    FOR SELECT USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Users can create quality inspections for their projects" ON quality_inspections
    FOR INSERT WITH CHECK (
        created_by = auth.uid() AND
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Users can update quality inspections for their projects" ON quality_inspections
    FOR UPDATE USING (
        created_by = auth.uid() OR
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Users can delete quality inspections for their projects" ON quality_inspections
    FOR DELETE USING (
        created_by = auth.uid() OR
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

-- RLS policies for quality_inspection_results
CREATE POLICY "Users can view inspection results for accessible inspections" ON quality_inspection_results
    FOR SELECT USING (
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can create inspection results for accessible inspections" ON quality_inspection_results
    FOR INSERT WITH CHECK (
        created_by = auth.uid() AND
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can update inspection results for accessible inspections" ON quality_inspection_results
    FOR UPDATE USING (
        created_by = auth.uid() OR
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can delete inspection results for accessible inspections" ON quality_inspection_results
    FOR DELETE USING (
        created_by = auth.uid() OR
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

-- RLS policies for quality_non_conformances
CREATE POLICY "Users can view nonconformances for accessible inspections" ON quality_non_conformances
    FOR SELECT USING (
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can create nonconformances for accessible inspections" ON quality_non_conformances
    FOR INSERT WITH CHECK (
        created_by = auth.uid() AND
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can update nonconformances for accessible inspections" ON quality_non_conformances
    FOR UPDATE USING (
        created_by = auth.uid() OR
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can delete nonconformances for accessible inspections" ON quality_non_conformances
    FOR DELETE USING (
        created_by = auth.uid() OR
        inspection_id IN (
            SELECT id FROM quality_inspections WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

-- Grant permissions
GRANT ALL ON quality_inspections TO authenticated;
GRANT ALL ON quality_inspection_results TO authenticated;
GRANT ALL ON quality_non_conformances TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE quality_inspections IS 'Main quality inspection records with planning and status information';
COMMENT ON TABLE quality_inspection_results IS 'Detailed inspection results and measurements for each inspection';
COMMENT ON TABLE quality_non_conformances IS 'Quality non-conformance issues and their resolution tracking';

COMMENT ON COLUMN quality_inspections.selected_items IS 'JSON array of BOM item IDs selected for inspection';
COMMENT ON COLUMN quality_inspections.quality_standards IS 'JSON array of applicable quality standards';
COMMENT ON COLUMN quality_inspections.checklist IS 'JSON array of inspection checklist items';
COMMENT ON COLUMN quality_inspection_results.measurement_values IS 'JSON array of multiple measurement readings';
-- Quality Control Database Schema - MINIMAL SAFE VERSION
-- This version creates only the essential tables without any dependencies
-- Principal Engineer Approach: Minimal viable migration first

-- Step 1: Create core tables with minimal constraints
CREATE TABLE IF NOT EXISTS quality_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(100) DEFAULT 'first-article',
  status VARCHAR(50) DEFAULT 'planned',
  project_id UUID,  -- Just a UUID column, no references
  bom_id UUID,      -- Just a UUID column, no references
  inspector VARCHAR(255),
  planned_date TIMESTAMP WITH TIME ZONE,
  actual_start_date TIMESTAMP WITH TIME ZONE,
  actual_end_date TIMESTAMP WITH TIME ZONE,
  selected_items JSONB DEFAULT '[]',
  quality_standards JSONB DEFAULT '[]',
  checklist JSONB DEFAULT '[]',
  overall_result VARCHAR(20),
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
  inspection_id UUID NOT NULL,
  bom_item_id UUID,
  checklist_item_id VARCHAR(255),
  measurement_type VARCHAR(100),
  description TEXT,
  expected_value DECIMAL(10,4),
  actual_value DECIMAL(10,4),
  tolerance DECIMAL(10,4) DEFAULT 0.1,
  unit VARCHAR(20) DEFAULT 'mm',
  result VARCHAR(20),
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
  inspection_id UUID NOT NULL,
  bom_item_id UUID,
  nonconformance_type VARCHAR(100),
  severity VARCHAR(20) DEFAULT 'minor',
  status VARCHAR(50) DEFAULT 'open',
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

-- Step 2: Create basic indexes
CREATE INDEX IF NOT EXISTS idx_quality_inspections_project_id ON quality_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_bom_id ON quality_inspections(bom_id);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_status ON quality_inspections(status);
CREATE INDEX IF NOT EXISTS idx_quality_inspections_created_by ON quality_inspections(created_by);

CREATE INDEX IF NOT EXISTS idx_quality_inspection_results_inspection_id ON quality_inspection_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_quality_nonconformances_inspection_id ON quality_non_conformances(inspection_id);

-- Step 3: Create simple update trigger function
CREATE OR REPLACE FUNCTION update_quality_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create triggers
DROP TRIGGER IF EXISTS update_quality_inspections_updated_at ON quality_inspections;
CREATE TRIGGER update_quality_inspections_updated_at 
    BEFORE UPDATE ON quality_inspections 
    FOR EACH ROW EXECUTE FUNCTION update_quality_updated_at_column();

DROP TRIGGER IF EXISTS update_quality_inspection_results_updated_at ON quality_inspection_results;
CREATE TRIGGER update_quality_inspection_results_updated_at 
    BEFORE UPDATE ON quality_inspection_results 
    FOR EACH ROW EXECUTE FUNCTION update_quality_updated_at_column();

DROP TRIGGER IF EXISTS update_quality_nonconformances_updated_at ON quality_non_conformances;
CREATE TRIGGER update_quality_nonconformances_updated_at 
    BEFORE UPDATE ON quality_non_conformances 
    FOR EACH ROW EXECUTE FUNCTION update_quality_updated_at_column();

-- Step 5: Disable RLS for now (can be enabled later when we know the schema)
ALTER TABLE quality_inspections DISABLE ROW LEVEL SECURITY;
ALTER TABLE quality_inspection_results DISABLE ROW LEVEL SECURITY;
ALTER TABLE quality_non_conformances DISABLE ROW LEVEL SECURITY;

-- Step 6: Grant basic permissions
DO $$
BEGIN
    -- Check if authenticated role exists
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT ALL ON quality_inspections TO authenticated;
        GRANT ALL ON quality_inspection_results TO authenticated;
        GRANT ALL ON quality_non_conformances TO authenticated;
    ELSE
        RAISE NOTICE 'authenticated role not found, skipping grants';
    END IF;
END $$;

-- Step 7: Add comments
COMMENT ON TABLE quality_inspections IS 'Quality inspection records - minimal safe version';
COMMENT ON TABLE quality_inspection_results IS 'Quality inspection results and measurements';
COMMENT ON TABLE quality_non_conformances IS 'Quality non-conformance tracking';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'SUCCESS: Quality Control tables created!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Tables created:';
    RAISE NOTICE '  - quality_inspections (with bom_id column)';
    RAISE NOTICE '  - quality_inspection_results';
    RAISE NOTICE '  - quality_non_conformances';
    RAISE NOTICE '';
    RAISE NOTICE 'Your Quality Control API should now work!';
    RAISE NOTICE '========================================';
END $$;
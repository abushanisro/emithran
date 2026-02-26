-- Quality Control - BASIC TABLE CREATION ONLY
-- Absolutely minimal version to fix the immediate API error

-- Create quality_inspections table - this is what the API needs
CREATE TABLE IF NOT EXISTS quality_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  type VARCHAR(100) DEFAULT 'first-article',
  status VARCHAR(50) DEFAULT 'planned',
  project_id UUID,
  bom_id UUID,
  inspector VARCHAR(255),
  planned_date TIMESTAMP WITH TIME ZONE,
  actual_start_date TIMESTAMP WITH TIME ZONE,
  actual_end_date TIMESTAMP WITH TIME ZONE,
  selected_items JSONB DEFAULT '[]',
  quality_standards JSONB DEFAULT '[]',
  checklist JSONB DEFAULT '[]',
  overall_result VARCHAR(20),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create supporting tables
CREATE TABLE IF NOT EXISTS quality_inspection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL,
  description TEXT,
  result VARCHAR(20),
  notes TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality_non_conformances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'open',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Just basic indexes
CREATE INDEX IF NOT EXISTS idx_qi_project_id ON quality_inspections(project_id);
CREATE INDEX IF NOT EXISTS idx_qi_status ON quality_inspections(status);

SELECT 'Quality Control tables created successfully!' as result;
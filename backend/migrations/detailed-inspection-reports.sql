-- Create detailed inspection reports table
CREATE TABLE IF NOT EXISTS detailed_inspection_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES quality_inspections(id) ON DELETE CASCADE,
    
    -- Balloon Drawing Data
    part_name VARCHAR(255) NOT NULL,
    material VARCHAR(255) NOT NULL,
    surface_treatment VARCHAR(255),
    drawing_title VARCHAR(255) NOT NULL,
    drawing_size VARCHAR(50) NOT NULL DEFAULT 'A4',
    balloon_annotations JSONB DEFAULT '[]'::jsonb,
    
    -- Final Inspection Report Data
    company_name VARCHAR(255) NOT NULL DEFAULT 'EMUSKI',
    revision_number VARCHAR(50),
    inspection_date DATE NOT NULL,
    raw_material VARCHAR(255) NOT NULL,
    inspection_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    general_remarks TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'release', 'rejected')),
    
    -- Inspection Table Data
    samples INTEGER NOT NULL DEFAULT 5 CHECK (samples >= 1 AND samples <= 5),
    measurements JSONB DEFAULT '[]'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(inspection_id)
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_detailed_inspection_reports_inspection_id ON detailed_inspection_reports(inspection_id);
CREATE INDEX IF NOT EXISTS idx_detailed_inspection_reports_status ON detailed_inspection_reports(status);
CREATE INDEX IF NOT EXISTS idx_detailed_inspection_reports_inspection_date ON detailed_inspection_reports(inspection_date);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_detailed_inspection_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_detailed_inspection_reports_updated_at
    BEFORE UPDATE ON detailed_inspection_reports
    FOR EACH ROW EXECUTE FUNCTION update_detailed_inspection_reports_updated_at();

-- Add comments for documentation
COMMENT ON TABLE detailed_inspection_reports IS 'Stores detailed inspection reports with balloon annotations and measurement data';
COMMENT ON COLUMN detailed_inspection_reports.balloon_annotations IS 'Array of balloon annotations with id, number, x, y coordinates';
COMMENT ON COLUMN detailed_inspection_reports.measurements IS 'Array of measurement data with specifications, tolerances, and sample values';
COMMENT ON COLUMN detailed_inspection_reports.samples IS 'Number of samples (1-5) for each measurement';
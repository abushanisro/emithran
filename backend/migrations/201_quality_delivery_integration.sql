-- =====================================================
-- Quality-Delivery Integration Schema Migration (Simplified)
-- Creates a basic bridge between quality control and delivery modules
-- =====================================================

-- Create a basic quality_approved_items table for demo purposes
-- In production, this would integrate with your existing quality module
CREATE TABLE IF NOT EXISTS quality_approved_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
  
  -- Approval details
  approved_quantity INTEGER NOT NULL CHECK (approved_quantity > 0),
  approval_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'conditionally_approved', 'rejected')),
  approval_notes TEXT,
  conditions TEXT, -- For conditionally approved items
  
  -- Quality certification
  qc_certificate_number VARCHAR(100) UNIQUE,
  certificate_date DATE,
  certificate_valid_until DATE,
  quality_grade VARCHAR(50), -- A, B, C grade or custom grading system
  
  -- Batch/lot information
  batch_number VARCHAR(100),
  lot_number VARCHAR(100),
  serial_numbers TEXT[], -- For serialized items
  manufacturing_date DATE,
  expiry_date DATE,
  
  -- Physical properties
  actual_weight_kg DECIMAL(10, 3),
  actual_dimensions_cm VARCHAR(100), -- "L x W x H"
  color VARCHAR(100),
  finish VARCHAR(100),
  
  -- Delivery readiness
  delivery_ready BOOLEAN NOT NULL DEFAULT false,
  delivery_ready_date TIMESTAMP WITH TIME ZONE,
  delivery_notes TEXT,
  packaging_requirements TEXT,
  special_handling_instructions TEXT,
  
  -- Approval workflow (simplified - using string instead of auth.users references)
  approved_by VARCHAR(100),
  approved_at TIMESTAMP WITH TIME ZONE,
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  
  -- Storage and location
  storage_location VARCHAR(200),
  warehouse_section VARCHAR(100),
  bin_location VARCHAR(100),
  
  -- Cost information
  approved_unit_cost_inr DECIMAL(12, 2),
  quality_premium_inr DECIMAL(10, 2) DEFAULT 0, -- Additional cost due to higher quality grade
  
  -- Metadata
  inspection_data JSONB DEFAULT '{}', -- Store specific inspection measurements
  compliance_certifications JSONB DEFAULT '[]', -- ISO, CE, etc.
  test_results JSONB DEFAULT '{}', -- Detailed test results
  photos TEXT[], -- URLs to photos of approved items
  
  -- Audit fields (simplified)
  created_by VARCHAR(100) NOT NULL,
  updated_by VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT positive_approved_quantity CHECK (approved_quantity > 0),
  CONSTRAINT valid_certificate_dates CHECK (certificate_valid_until IS NULL OR certificate_valid_until >= certificate_date),
  CONSTRAINT valid_expiry_date CHECK (expiry_date IS NULL OR expiry_date >= manufacturing_date),
  CONSTRAINT approval_consistency CHECK (
    (approval_status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR
    (approval_status != 'approved')
  )
);

-- Create indexes for performance
CREATE INDEX idx_quality_approved_items_bom_item_id ON quality_approved_items(bom_item_id);
CREATE INDEX idx_quality_approved_items_approval_status ON quality_approved_items(approval_status);
CREATE INDEX idx_quality_approved_items_delivery_ready ON quality_approved_items(delivery_ready);
CREATE INDEX idx_quality_approved_items_approved_by ON quality_approved_items(approved_by);
CREATE INDEX idx_quality_approved_items_certificate_number ON quality_approved_items(qc_certificate_number);
CREATE INDEX idx_quality_approved_items_batch_lot ON quality_approved_items(batch_number, lot_number);
CREATE INDEX idx_quality_approved_items_created_at ON quality_approved_items(created_at);

-- Create composite indexes for common query patterns
CREATE INDEX idx_quality_approved_items_delivery_query ON quality_approved_items(approval_status, delivery_ready);
CREATE INDEX idx_quality_approved_items_project_lookup ON quality_approved_items(bom_item_id, approval_status, delivery_ready);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_quality_approved_items_updated_at 
    BEFORE UPDATE ON quality_approved_items 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically generate QC certificate numbers
CREATE OR REPLACE FUNCTION generate_qc_certificate_number()
RETURNS TRIGGER AS $$
DECLARE
    project_prefix VARCHAR(50);
    sequence_num INTEGER;
    new_cert_number VARCHAR(100);
BEGIN
    -- Get project name from the BOM item (simplified - using project name instead of code)
    SELECT COALESCE(SUBSTRING(p.name FROM 1 FOR 8), 'PROJ') INTO project_prefix
    FROM bom_items bi
    JOIN boms b ON bi.bom_id = b.id  
    JOIN projects p ON b.project_id = p.id
    WHERE bi.id = NEW.bom_item_id;
    
    -- Generate sequence number for this project
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(qc_certificate_number FROM project_prefix || '-QC-(\d+)') AS INTEGER)
    ), 0) + 1 INTO sequence_num
    FROM quality_approved_items qai
    JOIN bom_items bi ON qai.bom_item_id = bi.id
    JOIN boms b ON bi.bom_id = b.id
    JOIN projects p ON b.project_id = p.id
    WHERE qc_certificate_number LIKE project_prefix || '-QC-%';
    
    new_cert_number := project_prefix || '-QC-' || LPAD(sequence_num::VARCHAR, 4, '0');
    NEW.qc_certificate_number := new_cert_number;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate certificate numbers when approval status changes to approved
CREATE TRIGGER generate_qc_certificate_trigger
    BEFORE UPDATE OF approval_status ON quality_approved_items
    FOR EACH ROW 
    WHEN (NEW.approval_status = 'approved' AND OLD.approval_status != 'approved' AND NEW.qc_certificate_number IS NULL)
    EXECUTE FUNCTION generate_qc_certificate_number();

-- Also generate certificate number on insert if status is already approved
CREATE TRIGGER generate_qc_certificate_insert_trigger
    BEFORE INSERT ON quality_approved_items
    FOR EACH ROW 
    WHEN (NEW.approval_status = 'approved' AND NEW.qc_certificate_number IS NULL)
    EXECUTE FUNCTION generate_qc_certificate_number();

-- Function to update delivery readiness based on approval status
CREATE OR REPLACE FUNCTION update_delivery_readiness()
RETURNS TRIGGER AS $$
BEGIN
    -- Automatically set delivery_ready when approved
    IF NEW.approval_status = 'approved' THEN
        NEW.delivery_ready := true;
        NEW.delivery_ready_date := COALESCE(NEW.delivery_ready_date, NOW());
    ELSE
        NEW.delivery_ready := false;
        NEW.delivery_ready_date := NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update delivery readiness
CREATE TRIGGER update_delivery_readiness_trigger
    BEFORE INSERT OR UPDATE ON quality_approved_items
    FOR EACH ROW 
    EXECUTE FUNCTION update_delivery_readiness();

-- Row Level Security
ALTER TABLE quality_approved_items ENABLE ROW LEVEL SECURITY;

-- Create view for delivery-ready items with project context (simplified)
CREATE OR REPLACE VIEW delivery_ready_items AS
SELECT 
    qai.*,
    b.project_id,
    bi.part_number,
    bi.description as item_description,
    bi.material,
    bi.unit,
    bi.unit_cost_inr,
    p.name as project_name
FROM quality_approved_items qai
JOIN bom_items bi ON qai.bom_item_id = bi.id
JOIN boms b ON bi.bom_id = b.id
JOIN projects p ON b.project_id = p.id
WHERE qai.approval_status = 'approved' 
AND qai.delivery_ready = true;

-- Grant access to the view
GRANT SELECT ON delivery_ready_items TO authenticated;

-- Create materialized view for delivery metrics (refresh periodically)
CREATE MATERIALIZED VIEW delivery_quality_metrics AS
SELECT 
    p.id as project_id,
    p.name as project_name,
    COUNT(qai.id) as total_approved_items,
    COUNT(qai.id) FILTER (WHERE qai.delivery_ready = true) as delivery_ready_items,
    COUNT(qai.id) FILTER (WHERE qai.approval_status = 'approved') as approved_items,
    COUNT(qai.id) FILTER (WHERE qai.approval_status = 'conditionally_approved') as conditional_items,
    COUNT(qai.id) FILTER (WHERE qai.approval_status = 'rejected') as rejected_items,
    AVG(qai.approved_quantity) as avg_approved_quantity,
    SUM(qai.approved_quantity) as total_approved_quantity,
    SUM(qai.approved_unit_cost_inr * qai.approved_quantity) as total_approved_value_inr
FROM projects p
LEFT JOIN boms b ON p.id = b.project_id
LEFT JOIN bom_items bi ON b.id = bi.bom_id
LEFT JOIN quality_approved_items qai ON bi.id = qai.bom_item_id
GROUP BY p.id, p.name;

-- Create index on materialized view
CREATE INDEX idx_delivery_quality_metrics_project_id ON delivery_quality_metrics(project_id);

-- Function to refresh metrics
CREATE OR REPLACE FUNCTION refresh_delivery_quality_metrics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW delivery_quality_metrics;
END;
$$ LANGUAGE plpgsql;

-- Add table comments
COMMENT ON TABLE quality_approved_items IS 'Bridge table between quality inspections and delivery - stores approved items ready for delivery';
COMMENT ON VIEW delivery_ready_items IS 'View of all quality-approved items that are ready for delivery with project context';
COMMENT ON MATERIALIZED VIEW delivery_quality_metrics IS 'Aggregated metrics for quality approval and delivery readiness by project';

-- Add column comments for key fields
COMMENT ON COLUMN quality_approved_items.delivery_ready IS 'Indicates if the approved item is ready for delivery (passes all quality gates)';
COMMENT ON COLUMN quality_approved_items.qc_certificate_number IS 'Auto-generated quality certificate number for the approved item';
COMMENT ON COLUMN quality_approved_items.approval_status IS 'Quality approval status: pending, approved, conditionally_approved, rejected';
COMMENT ON COLUMN quality_approved_items.conditions IS 'Special conditions or requirements for conditionally approved items';
COMMENT ON COLUMN quality_approved_items.inspection_data IS 'JSON storage for specific inspection measurements and test results';

-- Insert some sample data for testing
INSERT INTO quality_approved_items (
    bom_item_id, 
    approved_quantity, 
    approval_status, 
    approved_by, 
    approved_at,
    created_by
) 
SELECT 
    id,
    1,
    'approved',
    'system',
    NOW(),
    'system'
FROM bom_items 
LIMIT 5;
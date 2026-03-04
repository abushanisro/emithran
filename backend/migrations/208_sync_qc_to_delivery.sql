-- Sync approved quality inspections to delivery-ready items
-- This bridges the gap between your QC reports and delivery module

-- First, make sure the quality_approved_items table exists
CREATE TABLE IF NOT EXISTS quality_approved_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id UUID NOT NULL,
  approved_quantity INTEGER NOT NULL CHECK (approved_quantity > 0),
  approval_status VARCHAR(50) NOT NULL DEFAULT 'approved',
  delivery_ready BOOLEAN NOT NULL DEFAULT true,
  qc_certificate_number VARCHAR(100),
  certificate_date DATE DEFAULT CURRENT_DATE,
  quality_grade VARCHAR(50) DEFAULT 'A',
  batch_number VARCHAR(100),
  approved_by VARCHAR(100),
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_unit_cost_inr DECIMAL(12, 2),
  delivery_notes TEXT,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_quality_approved_items_bom_item_id ON quality_approved_items(bom_item_id);
CREATE INDEX IF NOT EXISTS idx_quality_approved_items_delivery_ready ON quality_approved_items(delivery_ready);

-- Clear existing system-generated data to avoid duplicates
DELETE FROM quality_approved_items WHERE created_by = 'qc_sync';

-- Sync approved quality inspections to quality_approved_items
INSERT INTO quality_approved_items (
    bom_item_id,
    approved_quantity,
    approval_status,
    delivery_ready,
    qc_certificate_number,
    certificate_date,
    quality_grade,
    batch_number,
    approved_by,
    approved_at,
    approved_unit_cost_inr,
    delivery_notes,
    created_by
)
SELECT DISTINCT
    bi.id as bom_item_id,
    COALESCE(bi.quantity, 1) as approved_quantity,
    'approved' as approval_status,
    true as delivery_ready,
    qi.id::text as qc_certificate_number, -- Use QC inspection ID as certificate number
    qi.approved_at::date as certificate_date,
    CASE 
        WHEN qi.status = 'approved' THEN 'A'
        WHEN qi.status = 'conditionally_approved' THEN 'B'
        ELSE 'C'
    END as quality_grade,
    'BATCH-' || TO_CHAR(qi.created_at, 'YYYYMM') || '-' || LPAD(ROW_NUMBER() OVER (ORDER BY qi.created_at)::text, 3, '0') as batch_number,
    qi.approved_by,
    qi.approved_at,
    COALESCE(bi.unit_cost_inr, 100) as approved_unit_cost_inr,
    'Approved from QC inspection: ' || qi.name as delivery_notes,
    'qc_sync' as created_by
FROM quality_inspections qi
JOIN boms b ON qi.bom_id = b.id
JOIN bom_items bi ON b.id = bi.bom_id
WHERE qi.status = 'approved'  -- Only fully approved reports, not first-article or in-process
  AND qi.approved_by IS NOT NULL
  AND qi.approved_at IS NOT NULL
  -- Focus on your current project
  AND b.project_id = 'bc7f8e60-fd5c-41af-8ac4-4d2882834daf';

-- Log the results
DO $$
DECLARE
    synced_count INTEGER;
    project_name TEXT;
BEGIN
    -- Get project name
    SELECT name INTO project_name 
    FROM projects 
    WHERE id = 'bc7f8e60-fd5c-41af-8ac4-4d2882834daf';
    
    -- Count synced items
    SELECT COUNT(*) INTO synced_count
    FROM quality_approved_items 
    WHERE created_by = 'qc_sync';
    
    RAISE NOTICE 'Synced % approved quality inspection items for project: %', synced_count, COALESCE(project_name, 'Unknown Project');
    
    IF synced_count = 0 THEN
        RAISE NOTICE 'No approved quality inspections found to sync. Check if:';
        RAISE NOTICE '1. Quality inspections exist for project bc7f8e60-fd5c-41af-8ac4-4d2882834daf';
        RAISE NOTICE '2. Quality inspections have status = approved';
        RAISE NOTICE '3. Quality inspections have approved_by and approved_at filled';
    END IF;
END $$;
-- ============================================================================
-- Migration: Add Associated Process to Calculators
-- Version: 210
-- Description: Add associatedProcessId field to calculators table for process-wise filtering
-- ============================================================================

-- Add associated_process_id column to calculators table
ALTER TABLE calculators 
ADD COLUMN associated_process_id VARCHAR(100);

-- Add comment for documentation
COMMENT ON COLUMN calculators.associated_process_id IS 'Optional process ID to filter database lookups by process';

-- Create index for performance when filtering by process
CREATE INDEX idx_calculators_associated_process ON calculators(associated_process_id)
WHERE associated_process_id IS NOT NULL;

-- Add constraint to ensure valid process IDs (based on seeded processes)
ALTER TABLE calculators 
ADD CONSTRAINT valid_associated_process CHECK (
  associated_process_id IS NULL OR 
  associated_process_id IN (
    'injection-molding', 'cnc-machining', 'sheet-metal-bending', 
    'laser-cutting', 'welding', 'die-casting', 'powder-coating', 
    'assembly', 'quality-inspection', 'heat-treatment'
  )
);

-- Update RLS policy to include associated_process_id in tenant isolation
DROP POLICY IF EXISTS calculators_tenant_isolation ON calculators;
CREATE POLICY calculators_tenant_isolation ON calculators
  FOR ALL USING (auth.uid() = user_id);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON calculators TO authenticated;
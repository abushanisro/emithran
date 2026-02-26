-- Safe version - Add foreign keys only where relationships exist
-- This prevents constraint violations

-- First, let's add the internal relationships that should always work
ALTER TABLE quality_inspection_results 
ADD CONSTRAINT fk_quality_inspection_results_inspection_id 
FOREIGN KEY (inspection_id) REFERENCES quality_inspections(id) ON DELETE CASCADE;

ALTER TABLE quality_non_conformances 
ADD CONSTRAINT fk_quality_non_conformances_inspection_id 
FOREIGN KEY (inspection_id) REFERENCES quality_inspections(id) ON DELETE CASCADE;

-- For project_id and bom_id, let's make them nullable and add constraints later
-- This allows the system to work without strict referential integrity for now
ALTER TABLE quality_inspections ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE quality_inspections ALTER COLUMN bom_id DROP NOT NULL;

-- Refresh schema cache
ANALYZE quality_inspections;
ANALYZE quality_inspection_results; 
ANALYZE quality_non_conformances;

-- Update any existing records with invalid project_id to NULL
UPDATE quality_inspections 
SET project_id = NULL 
WHERE project_id NOT IN (SELECT id FROM projects);

SELECT 'Safe foreign key constraints added successfully!' as result;
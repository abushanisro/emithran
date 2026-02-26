-- Add missing foreign key constraints for quality control tables
-- This will fix the schema cache relationship errors

-- Add foreign key constraint from quality_inspections to projects
ALTER TABLE quality_inspections 
ADD CONSTRAINT fk_quality_inspections_project_id 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- Add foreign key constraint from quality_inspection_results to quality_inspections
ALTER TABLE quality_inspection_results 
ADD CONSTRAINT fk_quality_inspection_results_inspection_id 
FOREIGN KEY (inspection_id) REFERENCES quality_inspections(id) ON DELETE CASCADE;

-- Add foreign key constraint from quality_non_conformances to quality_inspections
ALTER TABLE quality_non_conformances 
ADD CONSTRAINT fk_quality_non_conformances_inspection_id 
FOREIGN KEY (inspection_id) REFERENCES quality_inspections(id) ON DELETE CASCADE;

-- Add foreign key constraint from quality_inspections to boms (optional, can be null)
ALTER TABLE quality_inspections 
ADD CONSTRAINT fk_quality_inspections_bom_id 
FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE SET NULL;

-- Refresh schema cache by updating table statistics
ANALYZE quality_inspections;
ANALYZE quality_inspection_results;
ANALYZE quality_non_conformances;

SELECT 'Foreign key constraints added successfully!' as result;
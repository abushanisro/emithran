-- Add missing memory_metrics column to bom_items table
-- This column is referenced in the CAD analysis service but doesn't exist

-- Add the memory_metrics column as JSONB to store memory optimization data
ALTER TABLE bom_items 
ADD COLUMN IF NOT EXISTS memory_metrics JSONB DEFAULT NULL;

-- Add comment to document the column purpose
COMMENT ON COLUMN bom_items.memory_metrics IS 'Memory optimization metrics from CAD analysis (JSONB format)';

-- Update the schema cache
NOTIFY pgrst, 'reload schema';

-- Log the migration
INSERT INTO schema_migrations (version, description) 
VALUES ('212', 'Add missing memory_metrics column to bom_items table');
-- Migration: Fix Project DELETE CASCADE Chain
-- Created: 2026-02-19
-- Description: Fix foreign key constraints to allow proper project deletion cascade

-- ISSUE 1: rfq_tracking.project_id is NOT NULL but has ON DELETE SET NULL
-- This causes constraint violation when deleting projects
-- Solution: Change to ON DELETE CASCADE since RFQ tracking should be removed when project is deleted

-- Drop the existing foreign key constraint
ALTER TABLE rfq_tracking DROP CONSTRAINT IF EXISTS rfq_tracking_project_id_fkey;

-- Re-add the foreign key with CASCADE DELETE instead of SET NULL
ALTER TABLE rfq_tracking 
ADD CONSTRAINT rfq_tracking_project_id_fkey 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- Update the comment to reflect the cascade behavior
COMMENT ON COLUMN rfq_tracking.project_id IS 'Reference to project - RFQ tracking is deleted when project is deleted (CASCADE)';

-- ISSUE 2: production_lot_materials has ON DELETE RESTRICT for bom_items
-- This prevents BOM item deletion which blocks project deletion
-- Solution: Change to CASCADE since production materials should be deleted with their BOM items

-- Drop the existing foreign key constraint
ALTER TABLE production_lot_materials DROP CONSTRAINT IF EXISTS production_lot_materials_bom_item_id_fkey;

-- Re-add the foreign key with CASCADE DELETE instead of RESTRICT
ALTER TABLE production_lot_materials 
ADD CONSTRAINT production_lot_materials_bom_item_id_fkey 
FOREIGN KEY (bom_item_id) REFERENCES bom_items(id) ON DELETE CASCADE;

-- Update the comment to reflect the cascade behavior
COMMENT ON COLUMN production_lot_materials.bom_item_id IS 'Reference to BOM item - Production materials are deleted when BOM item is deleted (CASCADE)';

-- ISSUE 3: bom_item_costs may have incorrect foreign key constraint
-- Ensure it has CASCADE DELETE for bom_item_id

-- Drop the existing foreign key constraint
ALTER TABLE bom_item_costs DROP CONSTRAINT IF EXISTS bom_item_costs_bom_item_id_fkey;

-- Re-add the foreign key with CASCADE DELETE
ALTER TABLE bom_item_costs 
ADD CONSTRAINT bom_item_costs_bom_item_id_fkey 
FOREIGN KEY (bom_item_id) REFERENCES bom_items(id) ON DELETE CASCADE;

-- Update the comment to reflect the cascade behavior
COMMENT ON COLUMN bom_item_costs.bom_item_id IS 'Reference to BOM item - Cost records are deleted when BOM item is deleted (CASCADE)';
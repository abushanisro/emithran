-- ============================================================================
-- FIX BOM ITEMS CASCADE DELETE - SIMPLIFIED VERSION
-- Version: 108v2  
-- Created: 2026-02-19
-- Author: Backend Performance Optimization
-- Description: Fix BOM items delete with existing table structure
-- ============================================================================

-- Drop the problematic migration first
DROP VIEW IF EXISTS bom_item_dependencies;
DROP FUNCTION IF EXISTS safe_delete_bom_item(UUID);
DROP FUNCTION IF EXISTS cascade_delete_bom_item(UUID);

-- Migration Safety Checks
DO $$
BEGIN
  RAISE NOTICE 'Starting BOM Items Delete Fix Migration (Simplified)';
END $$;

-- ============================================================================
-- 1. CREATE SIMPLIFIED SAFE DELETE FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION safe_delete_bom_item(item_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT, affected_tables TEXT[]) AS $$
DECLARE
  related_count INTEGER;
  affected_tables_list TEXT[] := '{}';
  item_name TEXT;
BEGIN
  -- Get item info for better error messages
  SELECT COALESCE(part_number, 'Unknown') INTO item_name 
  FROM bom_items 
  WHERE id = item_id;
  
  IF item_name = 'Unknown' OR item_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 'BOM item not found'::TEXT, affected_tables_list;
    RETURN;
  END IF;

  -- Check for related records that would prevent deletion
  
  -- Check if there are process routes referencing this item
  SELECT COUNT(*) INTO related_count 
  FROM process_routes 
  WHERE bom_item_id = item_id;
  
  IF related_count > 0 THEN
    affected_tables_list := array_append(affected_tables_list, 'process_routes');
  END IF;
  
  -- Check if there are child items
  SELECT COUNT(*) INTO related_count 
  FROM bom_items 
  WHERE parent_item_id = item_id;
  
  IF related_count > 0 THEN
    affected_tables_list := array_append(affected_tables_list, 'child_bom_items');
  END IF;
  
  -- Check if there are production lot materials referencing this item
  SELECT COUNT(*) INTO related_count 
  FROM production_lot_materials 
  WHERE bom_item_id = item_id;
  
  IF related_count > 0 THEN
    affected_tables_list := array_append(affected_tables_list, 'production_lot_materials');
  END IF;
  
  -- If there are related records, return error
  IF array_length(affected_tables_list, 1) > 0 THEN
    RETURN QUERY SELECT FALSE, 
      FORMAT('Cannot delete BOM item "%s" - referenced by: %s. Please remove related references first.', 
             item_name, array_to_string(affected_tables_list, ', '))::TEXT,
      affected_tables_list;
    RETURN;
  END IF;
  
  -- Safe to delete - perform the actual delete
  DELETE FROM bom_items WHERE id = item_id;
  
  -- Check if delete was successful
  GET DIAGNOSTICS related_count = ROW_COUNT;
  
  IF related_count = 0 THEN
    RETURN QUERY SELECT FALSE, 'BOM item could not be deleted (may have been removed by another process)'::TEXT, affected_tables_list;
  ELSE
    RETURN QUERY SELECT TRUE, 
      FORMAT('BOM item "%s" deleted successfully', item_name)::TEXT,
      affected_tables_list;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. CREATE CASCADE DELETE FUNCTION (For Admin Use)
-- ============================================================================

CREATE OR REPLACE FUNCTION cascade_delete_bom_item(item_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT, deleted_records JSONB) AS $$
DECLARE
  deleted_info JSONB := '{}';
  item_name TEXT;
  related_count INTEGER;
BEGIN
  -- Get item info
  SELECT COALESCE(part_number, 'Unknown') INTO item_name 
  FROM bom_items 
  WHERE id = item_id;
  
  IF item_name = 'Unknown' OR item_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 'BOM item not found'::TEXT, deleted_info;
    RETURN;
  END IF;

  -- Delete related records in correct order
  
  -- 1. Delete production lot materials
  DELETE FROM production_lot_materials WHERE bom_item_id = item_id;
  GET DIAGNOSTICS related_count = ROW_COUNT;
  deleted_info := jsonb_set(deleted_info, '{production_materials}', to_jsonb(related_count));
  
  -- 2. Delete process route steps (if any process routes reference this item)
  DELETE FROM process_route_steps 
  WHERE process_route_id IN (
    SELECT id FROM process_routes WHERE bom_item_id = item_id
  );
  GET DIAGNOSTICS related_count = ROW_COUNT;
  deleted_info := jsonb_set(deleted_info, '{process_steps}', to_jsonb(related_count));
  
  -- 3. Delete process routes
  DELETE FROM process_routes WHERE bom_item_id = item_id;
  GET DIAGNOSTICS related_count = ROW_COUNT;
  deleted_info := jsonb_set(deleted_info, '{process_routes}', to_jsonb(related_count));
  
  -- 4. Update child items to remove parent reference
  UPDATE bom_items SET parent_item_id = NULL WHERE parent_item_id = item_id;
  GET DIAGNOSTICS related_count = ROW_COUNT;
  deleted_info := jsonb_set(deleted_info, '{orphaned_children}', to_jsonb(related_count));
  
  -- 5. Finally delete the BOM item
  DELETE FROM bom_items WHERE id = item_id;
  GET DIAGNOSTICS related_count = ROW_COUNT;
  deleted_info := jsonb_set(deleted_info, '{bom_item}', to_jsonb(related_count));
  
  IF related_count = 0 THEN
    RETURN QUERY SELECT FALSE, 'BOM item could not be deleted'::TEXT, deleted_info;
  ELSE
    RETURN QUERY SELECT TRUE, 
      FORMAT('BOM item "%s" and related records deleted successfully', item_name)::TEXT,
      deleted_info;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. CREATE SIMPLIFIED DEPENDENCIES VIEW
-- ============================================================================

CREATE OR REPLACE VIEW bom_item_dependencies AS
SELECT 
  bi.id as bom_item_id,
  bi.part_number,
  COALESCE(pr_count.process_routes, 0) as process_routes_count,
  COALESCE(child_count.children, 0) as child_items_count,
  COALESCE(prod_count.production_materials, 0) as production_materials_count,
  CASE 
    WHEN COALESCE(pr_count.process_routes, 0) > 0 OR 
         COALESCE(child_count.children, 0) > 0 OR 
         COALESCE(prod_count.production_materials, 0) > 0
    THEN FALSE 
    ELSE TRUE 
  END as safe_to_delete
FROM bom_items bi
LEFT JOIN (
  SELECT bom_item_id, COUNT(*) as process_routes
  FROM process_routes 
  WHERE bom_item_id IS NOT NULL
  GROUP BY bom_item_id
) pr_count ON bi.id = pr_count.bom_item_id
LEFT JOIN (
  SELECT parent_item_id, COUNT(*) as children
  FROM bom_items 
  WHERE parent_item_id IS NOT NULL
  GROUP BY parent_item_id
) child_count ON bi.id = child_count.parent_item_id
LEFT JOIN (
  SELECT bom_item_id, COUNT(*) as production_materials
  FROM production_lot_materials 
  WHERE bom_item_id IS NOT NULL
  GROUP BY bom_item_id
) prod_count ON bi.id = prod_count.bom_item_id;

-- ============================================================================
-- 4. GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION safe_delete_bom_item(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cascade_delete_bom_item(UUID) TO authenticated;
GRANT SELECT ON bom_item_dependencies TO authenticated;

-- ============================================================================
-- 5. VALIDATION
-- ============================================================================

DO $$
DECLARE
  function_count INTEGER;
  view_exists BOOLEAN;
BEGIN
  -- Count functions created
  SELECT COUNT(*) INTO function_count
  FROM pg_proc 
  WHERE proname IN ('safe_delete_bom_item', 'cascade_delete_bom_item');
  
  -- Check view
  SELECT EXISTS (
    SELECT FROM information_schema.views WHERE table_name = 'bom_item_dependencies'
  ) INTO view_exists;
  
  RAISE NOTICE 'BOM Items Delete Fix Validation (Simplified):';
  RAISE NOTICE '- Delete functions created: %', function_count;
  RAISE NOTICE '- Dependencies view created: %', view_exists;
  
  IF function_count >= 2 AND view_exists THEN
    RAISE NOTICE '✅ BOM Items delete fix completed successfully!';
  ELSE
    RAISE WARNING '⚠️  Migration may be incomplete. Please review.';
  END IF;
END $$;
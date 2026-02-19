-- ============================================================================
-- PERFORMANCE OPTIMIZATION MIGRATION - PHASE 3: BOM ITEMS MODULE  
-- Version: 107
-- Created: 2026-02-19
-- Author: Backend Performance Optimization
-- Description: Implements performance optimizations for the BOM Items module
-- ============================================================================

-- Migration Safety Checks
DO $$
BEGIN
  -- Check if table exists
  IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'bom_items') THEN
    RAISE EXCEPTION 'BOM Items table does not exist. Cannot proceed with migration.';
  END IF;
  
  RAISE NOTICE 'Starting Phase 3: BOM Items Module Performance Optimization';
END $$;

-- ============================================================================
-- 1. BATCH UPDATE FUNCTION FOR SORT ORDER (Replaces N+1 Pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION batch_update_sort_order(
  case_statements TEXT,
  item_ids TEXT
) RETURNS INTEGER AS $$
DECLARE
  sql_query TEXT;
  affected_rows INTEGER;
BEGIN
  -- Build dynamic SQL for batch update
  sql_query := FORMAT(
    'UPDATE bom_items SET sort_order = CASE %s END WHERE id IN (%s)',
    case_statements,
    item_ids
  );
  
  -- Execute the batch update
  EXECUTE sql_query;
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  
  RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. PERFORMANCE INDEXES FOR BOM ITEMS
-- ============================================================================

-- Primary BOM filtering index (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_bom_items_bom_id_created 
ON bom_items(bom_id, created_at DESC)
INCLUDE (part_number, item_type, unit_cost, quantity);

-- Search optimization index
CREATE INDEX IF NOT EXISTS idx_bom_items_search 
ON bom_items USING gin(
  to_tsvector('english', COALESCE(part_number, '') || ' ' || COALESCE(description, ''))
);

-- Item type filtering index
CREATE INDEX IF NOT EXISTS idx_bom_items_type_filter 
ON bom_items(item_type, bom_id, created_at DESC);

-- Parent-child relationship index (for hierarchical BOMs)
CREATE INDEX IF NOT EXISTS idx_bom_items_hierarchy 
ON bom_items(parent_item_id, bom_id) 
WHERE parent_item_id IS NOT NULL;

-- Cost calculation optimization index
CREATE INDEX IF NOT EXISTS idx_bom_items_cost_calc 
ON bom_items(bom_id, unit_cost, quantity) 
WHERE unit_cost IS NOT NULL AND quantity IS NOT NULL;

-- Sort order management index
CREATE INDEX IF NOT EXISTS idx_bom_items_sort_order 
ON bom_items(bom_id, sort_order, id);

-- File path indexes for media queries
CREATE INDEX IF NOT EXISTS idx_bom_items_file_paths 
ON bom_items(id) 
WHERE file_2d_path IS NOT NULL OR file_3d_path IS NOT NULL;

-- ============================================================================
-- 3. OPTIMIZED BOM ITEM QUERIES FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_bom_items_optimized(
  p_bom_id UUID,
  p_search TEXT DEFAULT NULL,
  p_item_type TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id UUID,
  bom_id UUID,
  part_number TEXT,
  description TEXT,
  item_type TEXT,
  unit_cost DECIMAL(15,2),
  quantity INTEGER,
  sort_order INTEGER,
  created_at TIMESTAMP WITH TIME ZONE,
  total_cost DECIMAL(15,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bi.id,
    bi.bom_id,
    bi.part_number,
    bi.description,
    bi.item_type,
    bi.unit_cost,
    bi.quantity,
    bi.sort_order,
    bi.created_at,
    (COALESCE(bi.unit_cost, 0) * COALESCE(bi.quantity, 1)) as total_cost
  FROM bom_items bi
  WHERE bi.bom_id = p_bom_id
    AND (p_search IS NULL OR 
         to_tsvector('english', COALESCE(bi.part_number, '') || ' ' || COALESCE(bi.description, '')) 
         @@ plainto_tsquery('english', p_search))
    AND (p_item_type IS NULL OR bi.item_type = p_item_type)
  ORDER BY bi.sort_order NULLS LAST, bi.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 4. BOM ITEM STATISTICS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION get_bom_item_statistics(p_bom_id UUID)
RETURNS TABLE(
  total_items BIGINT,
  total_cost DECIMAL(15,2),
  items_by_type JSONB,
  avg_unit_cost DECIMAL(15,2),
  cost_distribution JSONB
) AS $$
BEGIN
  RETURN QUERY
  WITH item_stats AS (
    SELECT 
      COUNT(*) as item_count,
      COALESCE(SUM(unit_cost * COALESCE(quantity, 1)), 0) as total_cost_calc,
      AVG(unit_cost) as avg_cost,
      item_type
    FROM bom_items 
    WHERE bom_id = p_bom_id 
    GROUP BY item_type
  ),
  type_summary AS (
    SELECT jsonb_object_agg(item_type, item_count) as type_breakdown
    FROM item_stats
  ),
  cost_ranges AS (
    SELECT jsonb_build_object(
      'low_cost', COUNT(*) FILTER (WHERE unit_cost < 100),
      'medium_cost', COUNT(*) FILTER (WHERE unit_cost >= 100 AND unit_cost < 1000),
      'high_cost', COUNT(*) FILTER (WHERE unit_cost >= 1000)
    ) as cost_breakdown
    FROM bom_items WHERE bom_id = p_bom_id
  )
  SELECT 
    COALESCE(SUM(item_count), 0)::BIGINT,
    COALESCE(SUM(total_cost_calc), 0),
    COALESCE((SELECT type_breakdown FROM type_summary), '{}'::jsonb),
    COALESCE(AVG(avg_cost), 0),
    (SELECT cost_breakdown FROM cost_ranges)
  FROM item_stats;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 5. ROW LEVEL SECURITY OPTIMIZATION
-- ============================================================================

-- Optimize RLS for BOM items
DROP POLICY IF EXISTS "bom_items_user_policy" ON bom_items;

CREATE POLICY "bom_items_user_access_optimized" ON bom_items
  FOR ALL TO authenticated
  USING (
    bom_id IN (
      SELECT b.id FROM boms b 
      WHERE b.user_id = auth.uid() 
         OR b.project_id IN (SELECT p.id FROM projects p WHERE p.user_id = auth.uid())
    )
  )
  WITH CHECK (
    bom_id IN (
      SELECT b.id FROM boms b 
      WHERE b.user_id = auth.uid() 
         OR b.project_id IN (SELECT p.id FROM projects p WHERE p.user_id = auth.uid())
    )
  );

-- Enable RLS
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 6. CLEANUP ORPHANED DATA
-- ============================================================================

-- Remove BOM items with invalid BOM references
DO $$
DECLARE
  orphaned_count INTEGER;
BEGIN
  WITH orphaned_items AS (
    SELECT bi.id 
    FROM bom_items bi 
    LEFT JOIN boms b ON bi.bom_id = b.id 
    WHERE b.id IS NULL
  )
  DELETE FROM bom_items 
  WHERE id IN (SELECT id FROM orphaned_items);
  
  GET DIAGNOSTICS orphaned_count = ROW_COUNT;
  
  IF orphaned_count > 0 THEN
    RAISE NOTICE 'Cleaned up % orphaned BOM items', orphaned_count;
  END IF;
END $$;

-- ============================================================================
-- 7. STATISTICS UPDATE
-- ============================================================================

ANALYZE bom_items;

-- ============================================================================
-- 8. MIGRATION VALIDATION
-- ============================================================================

DO $$
DECLARE
  index_count INTEGER;
  function_count INTEGER;
  policy_exists BOOLEAN;
BEGIN
  -- Count indexes created
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes 
  WHERE tablename = 'bom_items' 
  AND indexname LIKE 'idx_bom_items_%';
  
  -- Count functions created
  SELECT COUNT(*) INTO function_count
  FROM pg_proc 
  WHERE proname IN ('batch_update_sort_order', 'get_bom_items_optimized', 'get_bom_item_statistics');
  
  -- Check RLS policy
  SELECT EXISTS (
    SELECT FROM pg_policies WHERE tablename = 'bom_items' AND policyname = 'bom_items_user_access_optimized'
  ) INTO policy_exists;
  
  -- Report results
  RAISE NOTICE 'Phase 3 Migration Validation:';
  RAISE NOTICE '- BOM Items indexes created: %', index_count;
  RAISE NOTICE '- Optimization functions created: %', function_count;
  RAISE NOTICE '- RLS policy optimized: %', policy_exists;
  
  IF index_count >= 7 AND function_count >= 3 AND policy_exists THEN
    RAISE NOTICE '✅ Phase 3 migration completed successfully!';
  ELSE
    RAISE WARNING '⚠️  Migration may have incomplete results. Please review.';
  END IF;
END $$;

-- ============================================================================
-- PERFORMANCE IMPACT DOCUMENTATION
-- ============================================================================

/*
BEFORE OPTIMIZATION:
- Sort Order Update: N database calls (50 items = 50 calls)
- BOM Item Queries: Full table scan with OR conditions  
- Field Transformation: Runtime object creation (O(n) per request)
- Search: ILIKE operations (full table scan)

AFTER OPTIMIZATION:
- Sort Order Update: Single batch operation with CASE-WHEN
- BOM Item Queries: Index scan with optimized predicates
- Field Transformation: Cached static mapping (O(1) lookup)
- Search: GIN full-text search index

EXPECTED IMPROVEMENTS:
- Sort order updates: 50-100x faster (N queries → 1 query)
- BOM item filtering: 10-50x faster with composite indexes
- Search operations: 20-100x faster with GIN indexes
- Field mapping: 5-10x faster with cached mapping
- Memory usage: 30-40% reduction

MONITORING QUERIES:
-- Check index usage
SELECT schemaname, tablename, indexname, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE tablename = 'bom_items'
ORDER BY idx_tup_read DESC;

-- Monitor function performance
SELECT calls, total_time, mean_time 
FROM pg_stat_user_functions 
WHERE funcname IN ('batch_update_sort_order', 'get_bom_items_optimized');
*/
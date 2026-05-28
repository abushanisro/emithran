-- ============================================================================
-- Migration: Enforce uniqueness on process_calculator_mappings
-- Deduplicates existing rows (keeps lowest display_order per combo),
-- then adds a unique constraint so the application can safely upsert.
-- ============================================================================

-- Step 1: Remove duplicate rows, keeping the one with the smallest display_order
-- (ties broken by earliest created_at)
DELETE FROM process_calculator_mappings
WHERE id NOT IN (
  SELECT DISTINCT ON (process_group, process_route, operation) id
  FROM process_calculator_mappings
  ORDER BY process_group, process_route, operation, display_order ASC, created_at ASC
);

-- Step 2: Add unique constraint
ALTER TABLE process_calculator_mappings
  ADD CONSTRAINT uq_process_calculator_mapping
  UNIQUE (process_group, process_route, operation);

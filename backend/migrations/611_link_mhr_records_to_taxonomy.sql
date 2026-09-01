-- ============================================================================
-- Migration 611: Link mhr_records to process_taxonomy (Pass 1 -- direct join)
-- ============================================================================
-- Unlike process_calculator_mappings (migration 610, NOT NULL-guarded),
-- this FK is nullable on purpose: mhr_records spans every manufacturing
-- domain's machine catalog, and the process_route/operation reconciliation
-- done so far (migrations 569/572) only ever targeted Sheet Metal's 68
-- categories -- a genuine, disclosed coverage gap for everything else is
-- expected and correct here, never force-closed.
--
-- mhr_records has no process_group column, so this pass assumes
-- process_group = 'Sheet Metal' for any row with process_route/operation
-- already populated -- confirmed correct by migration 569's own header
-- ("a live read of process_calculator_mappings (Sheet Metal group, 68
-- rows)"), the only reconciliation effort mhr_records has ever had.
--
-- This is Pass 1 (direct route/operation join) only. Pass 2
-- (benchmark_source_key category-prefix matching, full coverage, all
-- process groups) and Pass 3 (unambiguous machine_class fallback) need
-- real live category data to write correctly rather than guessed alias
-- rules -- see the coverage-report query at the bottom; its output drives
-- migration 611b.
-- ============================================================================

BEGIN;

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS canonical_process_id UUID REFERENCES process_taxonomy(id);

UPDATE mhr_records mr
SET canonical_process_id = pt.id
FROM process_taxonomy pt
WHERE pt.process_group = 'Sheet Metal'
  AND pt.process_name = mr.operation
  AND mr.process_route IS NOT NULL
  AND mr.canonical_process_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mhr_records_canonical_process_id
  ON mhr_records(canonical_process_id);

COMMIT;

-- Coverage report -- run manually after, paste the result back so Pass 2
-- (benchmark_source_key category matching) can be written from real data
-- instead of a guess:
-- SELECT
--   split_part(benchmark_source_key, ':', 1) AS category,
--   count(*) AS row_count,
--   count(*) FILTER (WHERE canonical_process_id IS NOT NULL) AS linked,
--   count(DISTINCT machine_class) AS distinct_machine_classes
-- FROM mhr_records
-- WHERE location = 'USA'
-- GROUP BY category
-- ORDER BY linked ASC, row_count DESC;

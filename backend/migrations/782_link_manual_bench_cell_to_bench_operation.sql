-- ============================================================================
-- Migration 782: Link the 4 "Manual Bench Cell" mhr_records rows to the
-- "Bench Operation" process_taxonomy row (the last real gap migration 781's
-- generic join left unlinked)
-- ============================================================================
-- Migration 781's join (process_taxonomy.process_name =
-- split_part(mr.benchmark_source_key, ':', 1)) correctly linked 322 of 326
-- real Machining mhr_records rows. The remaining 4 are a real, sourced
-- naming alias, not a data error: their benchmark_source_key derives
-- "Manual Bench Cell" (the real machine economics category label from
-- memory/machining/machine/machiningusa.json), but process_taxonomy's
-- canonical process_name for this exact station is "Bench Operation"
-- (migration 691's own seed row: process_name='Bench Operation',
-- default_machine_name='Manual Bench Cell - 16m x 4m Footprint' — the
-- correspondence is already recorded in that row itself, not guessed here).
--
-- Idempotent: only touches canonical_process_id IS NULL rows; re-running
-- after the fix is a no-op.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

UPDATE mhr_records mr
SET canonical_process_id = pt.id
FROM process_taxonomy pt
WHERE mr.canonical_process_id IS NULL
  AND mr.process_group = 'Machining'
  AND pt.process_group = 'Machining'
  AND pt.process_name = 'Bench Operation'
  AND split_part(mr.benchmark_source_key, ':', 1) = 'Manual Bench Cell';

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FILTER (WHERE canonical_process_id IS NOT NULL) AS linked,
--        count(*) FILTER (WHERE canonical_process_id IS NULL) AS unlinked,
--        count(*) AS total
-- FROM mhr_records WHERE process_group = 'Machining';
-- Expect: linked=326, unlinked=0, total=326.

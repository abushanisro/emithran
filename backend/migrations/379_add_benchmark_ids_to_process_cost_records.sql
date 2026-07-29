-- ============================================================================
-- Migration 379: Persist benchmark machine/labour selections on process cost
-- records — root cause of "Machine dropdown shows blank" when re-opening a
-- saved process cost that used a benchmark (★) MHR/LHR rate.
--
-- Root cause: process-cost.service.ts's create()/update() already receive
-- createDto.benchmarkMhrId / benchmarkLhrId (added in an earlier session to
-- fix a DIFFERENT bug — deriving machine_name/machine_class/labor_type for
-- display) but NEVER persist the benchmark id itself anywhere on the row —
-- only mhr_id/lhr_id (which stay NULL for a benchmark pick, since it's not a
-- real mhr_records/lhr_records row) get stored. So the moment a benchmark
-- selection is saved, the reference to WHICH benchmark rate was chosen is
-- permanently lost — only the derived display fields (machine_name,
-- machine_rate, labor_type) survive. Reopening the record for editing has no
-- id to restore the dropdown's selection from, even though the display
-- panel (which just echoes the already-saved machine_name/rate) looks fine.
--
-- Fix: add columns to actually store the benchmark id, alongside the
-- matching backend (process-cost.service.ts, process-cost.dto.ts) and
-- frontend (ProcessCostDialog.tsx) changes to write and read them back.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

ALTER TABLE process_cost_records
  ADD COLUMN IF NOT EXISTS benchmark_mhr_id TEXT,
  ADD COLUMN IF NOT EXISTS benchmark_lhr_id TEXT;

COMMENT ON COLUMN process_cost_records.benchmark_mhr_id IS
  'ID of the mhr_benchmark_rates row selected (prefixed bm-mhr-<id>, matching mhr.service.ts''s getBenchmarkRates()), when the engineer picked a benchmark (★) machine rate instead of a real mhr_records row. NULL when mhr_id is set instead.';
COMMENT ON COLUMN process_cost_records.benchmark_lhr_id IS
  'ID of the lhr_benchmark_rates row selected (prefixed bm-lhr-<id>, matching lhr.service.ts''s getBenchmarkRates()), when the engineer picked a benchmark (★) labour rate instead of a real lhr_records row. NULL when lhr_id is set instead.';

NOTIFY pgrst, 'reload schema';

-- Verification: SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'process_cost_records' AND column_name LIKE 'benchmark_%_id';

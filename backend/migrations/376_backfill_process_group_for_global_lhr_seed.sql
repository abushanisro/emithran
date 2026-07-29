-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 376: Backfill process_group on the migration-180/183 global LHR
-- benchmark rows in lhr_records — the actual root cause of "Skilled CNC"
-- pricing a Post Processing / Hand Deburring operation.
--
-- Root cause (found by tracing exactly why migration 375's lhr_benchmark_rates
-- fix had no effect on this specific record): "Skilled CNC — $32.00/hr (USA)"
-- is NOT a row in lhr_benchmark_rates at all — it's a row in lhr_records
-- itself, seeded directly by database/migrations/180_seed_global_lhr_2026.sql
-- and 183_seed_india_mhr_lhr_fix_im_family.sql as global (user_id = NULL,
-- source_type = 'BENCHMARK') rows, one CNC-focused skill ladder per location
-- (Unskilled / Semi-Skilled / Skilled CNC / Highly Skilled). Those two
-- migrations set labour_family ('cnc', 'quality', or 'general') but NEVER set
-- process_group at all — the column ProcessCostDialog.tsx's byGroup filter and
-- the "should I inject the previously-saved record back into the list
-- regardless of match" logic (withSaved()) both actually key off.
--
-- ProcessCostDialog.tsx's withSaved() treats a saved labour record with NO
-- process_group as automatically "compatible" with any operation (a deliberate
-- design choice so a legitimately-saved record is never silently hidden just
-- because current filtering got stricter — see the MHR/LHR domain-scoping fix
-- from earlier in this cleanup). That's the right behavior when process_group
-- is genuinely unknowable — but here it isn't unknowable: labour_family='cnc'
-- already says exactly what this row is. The bug was never in the matching
-- logic; it's that a real, known classification was sitting in the wrong
-- column the whole time.
--
-- Fix: backfill process_group from labour_family, using the exact process
-- group names process_calculator_mappings/lhr_benchmark_rates already use —
-- no new vocabulary invented:
--   labour_family = 'cnc'     → process_group = 'CNC Machining'
--   labour_family = 'quality' → process_group = 'Quality'
--
-- labour_family = 'general' (the 'Unskilled' tier) is deliberately left alone:
-- unlike 'cnc'/'quality', "general" genuinely doesn't name one specific process
-- group — it's meant to apply broadly (material handling, general labour)
-- across many domains. Forcing it into a single group would be exactly the
-- kind of guess this cleanup has been removing, not fixing. It stays excluded
-- from group-matching until a real decision is made about how "Unskilled/
-- general" labour should be scoped (a follow-up, not silently done here).
--
-- Once process_group is real, no further code change is needed:
-- ProcessCostDialog.tsx's existing byGroup/withSaved logic will correctly stop
-- treating a CNC-tagged row as compatible with a Post Processing (or any other
-- non-machining) operation, and the existing auto-select will naturally pick a
-- properly-scoped default (from migration 375's now-complete lhr_benchmark_rates
-- coverage) the next time each affected record's dialog is opened.
--
-- Idempotent: scoped to process_group IS NULL, so re-running is a no-op once
-- applied.
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  cnc_count     INTEGER;
  quality_count INTEGER;
  general_count INTEGER;
BEGIN
  UPDATE lhr_records
  SET process_group = 'CNC Machining'
  WHERE process_group IS NULL
    AND labour_family = 'cnc';
  GET DIAGNOSTICS cnc_count = ROW_COUNT;

  UPDATE lhr_records
  SET process_group = 'Quality'
  WHERE process_group IS NULL
    AND labour_family = 'quality';
  GET DIAGNOSTICS quality_count = ROW_COUNT;

  SELECT COUNT(*) INTO general_count
  FROM lhr_records
  WHERE process_group IS NULL
    AND labour_family = 'general';

  RAISE NOTICE
    'Migration 376: backfilled process_group = ''CNC Machining'' on % row(s), ''Quality'' on % row(s). % ''general''/Unskilled row(s) deliberately left with NULL process_group (see migration comment) — still excluded from domain matching until scoped.',
    cnc_count, quality_count, general_count;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT labour_family, process_group, COUNT(*) FROM lhr_records
-- WHERE source_type = 'BENCHMARK' GROUP BY 1, 2 ORDER BY 1, 2;
-- Expected: no ('cnc', NULL) or ('quality', NULL) rows remain; ('general', NULL) is expected.

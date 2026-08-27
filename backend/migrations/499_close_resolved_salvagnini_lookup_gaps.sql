-- ============================================================================
-- Migration: Close 2 lookup_coverage_gaps entries verified resolved
-- Purpose: id 442 ("Salvagnini L3-30 2KW Fiber has no verified power_kw") is
--          now genuinely fixed -- migration 491 set power_kw=2.0 for this
--          exact machine (France, E. Europe), confirmed via direct query
--          against the live mhr_records table. id 459 ("Salvagnini L3-30
--          Fiber has no verified power_kw") is not reproducible with current
--          data -- that machine already has power_kw=6.0 in every location
--          (China/India/Mexico/USA/Germany); the open gap record was stale.
--          Marking both resolved so the gap-tracking table reflects reality
--          instead of recurring as "still open" noise.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

UPDATE lookup_coverage_gaps
SET status = 'resolved'
WHERE id IN (442, 459)
  AND status = 'open';

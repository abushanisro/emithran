-- ============================================================================
-- Migration 643: Replace mhr_records.wage_grade's fabricated classification
-- with real, sourced Digital Factory wage-grade values
--
-- Root-cause fix: migration 577 populated wage_grade on all 294 live
-- Sheet Metal mhr_records rows with an INVENTED 3-tier classification
-- (Skilled / Semi-Skilled / Unskilled) based on the engineer's own
-- judgment about "real skill requirement" per machine category (see 577's
-- own header comment) -- it was never sourced from the actual Digital
-- Factory reference tool. That was a real gap at the time: no real
-- per-process wage-grade data existed yet.
--
-- It exists now -- memory/sheetmetal/wages.png (a real Digital Factory
-- "Wage Grade Associations" screenshot), staged as sm_reference_data
-- category='wage_grade' by migration 641 (2026-09 snapshot, source_region
-- USA). This migration replaces 577's guessed 3-tier values with the real
-- per-category grade names from that screenshot, using the exact same
-- benchmark_source_key LIKE '<category>:%' matching migration 577 (and
-- 569 before it) already established for these 15 categories.
--
-- Only overwrites rows still holding one of migration 577's own three
-- fabricated values (Skilled/Semi-Skilled/Unskilled) -- never touches a
-- row a shop has since hand-edited via the MHR admin UI, matching 577's
-- own "never overwrites a real shop-entered value" discipline.
--
-- Category -> real wage grade (migration 641 process name in parens):
--   2-Axis Router              -> '3 - Metal'  (2 Axis Router)
--   3 Roll Bender               -> '4 - Metal'  (3 Roll Bending)
--   3D Laser Cutting Machine    -> '3 - Metal'  (3D Laser)
--   4 Roll Bender                -> '4 - Metal'  (4 Roll Bending)
--   Bend Press Brake            -> '3 - Metal'  (Bend Brake)
--   Laser Cutting Machine       -> '3 - Metal'  (Laser Cut)
--   Fiber Laser Cutting Machine -> '3 - Metal'  (Fiber Laser Cut)
--   Laser Punch / Punch Press   -> '3 - Metal'  (Laser Punch)
--   Waterjet Cutting Machine    -> '3 - Metal'  (Waterjet Cut)
--   Turret Press (Punch Press)  -> '3 - Metal'  (Turret Press)
--   Progressive Die Press       -> '3 - Metal'  (Progressive Die)
--   Cut To Length Line (CTL)    -> '2 - Metal'  (CTL)
--   Oxyfuel Cutting Machine     -> '3 - Metal'  (OxyFuel Cut)
--   Tandem Press                -> '3 - Metal'  (Tandem Press)
--   Deslag Machine               -> '2 - Metal'  (Deslag)
--
-- Note the real data restores granularity 577's flat 3-tier bucket lost:
-- 3/4 Roll Bender are the only 2 of these 15 at the higher '4 - Metal'
-- tier -- 577 bucketed them into the same generic "Skilled" tier as the
-- other 9, losing that distinction entirely.
-- ============================================================================

BEGIN;

UPDATE mhr_records SET wage_grade = '3 - Metal'
WHERE wage_grade IN ('Skilled', 'Semi-Skilled', 'Unskilled') AND (
  benchmark_source_key LIKE '2-Axis Router:%' OR
  benchmark_source_key LIKE '3D Laser Cutting Machine:%' OR
  benchmark_source_key LIKE 'Bend Press Brake:%' OR
  benchmark_source_key LIKE 'Laser Cutting Machine:%' OR
  benchmark_source_key LIKE 'Fiber Laser Cutting Machine:%' OR
  benchmark_source_key LIKE 'Laser Punch / Punch Press:%' OR
  benchmark_source_key LIKE 'Waterjet Cutting Machine:%' OR
  benchmark_source_key LIKE 'Turret Press (Punch Press):%' OR
  benchmark_source_key LIKE 'Progressive Die Press:%' OR
  benchmark_source_key LIKE 'Oxyfuel Cutting Machine:%' OR
  benchmark_source_key LIKE 'Tandem Press:%'
);

UPDATE mhr_records SET wage_grade = '4 - Metal'
WHERE wage_grade IN ('Skilled', 'Semi-Skilled', 'Unskilled') AND (
  benchmark_source_key LIKE '3 Roll Bender:%' OR
  benchmark_source_key LIKE '4 Roll Bender:%'
);

UPDATE mhr_records SET wage_grade = '2 - Metal'
WHERE wage_grade IN ('Skilled', 'Semi-Skilled', 'Unskilled') AND (
  benchmark_source_key LIKE 'Cut To Length Line (CTL):%' OR
  benchmark_source_key LIKE 'Deslag Machine:%'
);

COMMIT;

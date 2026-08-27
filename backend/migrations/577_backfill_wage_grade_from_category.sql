-- ============================================================================
-- Migration 577: Backfill mhr_records.wage_grade from real machine category
--
-- Context: wage_grade is blank on all 294 live rows (confirmed via a live
-- query, 2026-08-27) — never populated by any prior import. The reference
-- source (memory/sheetmetal/machine/machine_library.json) carried an empty
-- wage_grade_name on all 281 machines too; that file has now been backfilled
-- category-by-category with a simple 3-tier classification, matching how
-- migration 569 already classifies these same 15 categories by real skill
-- requirement:
--
--   Skilled      — CNC-programmed / precision setup work: bend sequencing on
--                   a press brake, turret/die tooling changeover, roll-pass
--                   calculation on a plate roll, multi-axis laser/router/
--                   waterjet programming. (2-Axis Router, 3 Roll Bender,
--                   3D Laser Cutting Machine, 4 Roll Bender, Bend Press
--                   Brake, Laser Cutting Machine, Fiber Laser Cutting
--                   Machine, Laser Punch / Punch Press, Waterjet Cutting
--                   Machine, Turret Press (Punch Press), Progressive Die
--                   Press)
--   Semi-Skilled — largely automated line/press tending once set up by
--                   someone else: coil-fed cut-to-length line monitoring,
--                   tandem press loading/unloading, oxyfuel torch cutting.
--                   (Cut To Length Line (CTL), Oxyfuel Cutting Machine,
--                   Tandem Press)
--   Unskilled    — manual post-process bench work needing minimal training:
--                   slag/dross removal. (Deslag Machine)
--
-- Only fills rows with wage_grade currently NULL/blank — never overwrites a
-- real shop-entered value, though none exist live today. Uses the same
-- benchmark_source_key LIKE '<category>:%' match migration 569 already
-- established for these exact categories; rows with no reference match
-- (manually-entered/legacy machines) are left untouched, same as 569.
-- ============================================================================

BEGIN;

UPDATE mhr_records SET wage_grade = 'Skilled'
WHERE (wage_grade IS NULL OR wage_grade = '') AND (
  benchmark_source_key LIKE '2-Axis Router:%' OR
  benchmark_source_key LIKE '3 Roll Bender:%' OR
  benchmark_source_key LIKE '3D Laser Cutting Machine:%' OR
  benchmark_source_key LIKE '4 Roll Bender:%' OR
  benchmark_source_key LIKE 'Bend Press Brake:%' OR
  benchmark_source_key LIKE 'Laser Cutting Machine:%' OR
  benchmark_source_key LIKE 'Fiber Laser Cutting Machine:%' OR
  benchmark_source_key LIKE 'Laser Punch / Punch Press:%' OR
  benchmark_source_key LIKE 'Waterjet Cutting Machine:%' OR
  benchmark_source_key LIKE 'Turret Press (Punch Press):%' OR
  benchmark_source_key LIKE 'Progressive Die Press:%'
);

UPDATE mhr_records SET wage_grade = 'Semi-Skilled'
WHERE (wage_grade IS NULL OR wage_grade = '') AND (
  benchmark_source_key LIKE 'Cut To Length Line (CTL):%' OR
  benchmark_source_key LIKE 'Oxyfuel Cutting Machine:%' OR
  benchmark_source_key LIKE 'Tandem Press:%'
);

UPDATE mhr_records SET wage_grade = 'Unskilled'
WHERE (wage_grade IS NULL OR wage_grade = '') AND
  benchmark_source_key LIKE 'Deslag Machine:%';

COMMIT;

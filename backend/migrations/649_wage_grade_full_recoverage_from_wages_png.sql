-- ============================================================================
-- Migration 649: mhr_records.wage_grade — full, unconditional recoverage
-- from memory/sheetmetal/wages.png for every real Sheet Metal category
--
-- Migration 643 only replaced rows that still held one of migration 577's
-- ORIGINAL 15-category fabricated Skilled/Semi-Skilled/Unskilled values.
-- Confirmed live (2026-09-03) this left real gaps:
--   - 2 categories outside 577's documented scope still carry a fabricated
--     value (577's era also retroactively "backfilled" machine_library.json
--     itself category-by-category, beyond just the 15 mhr_records rows it
--     directly touched -- see 577's own header): Plasma Cutting Machine
--     (13 rows, 'Skilled'), 2 Roll Bender (4 rows, 'Skilled').
--   - Thousands of rows across EVERY category are simply NULL -- real
--     machines imported after 577/643 ran (multi-location legacy imports,
--     2026-08-28+) that neither migration was ever scoped to touch.
--
-- This migration makes wages.png (already staged as sm_reference_data
-- category='wage_grade', source_version='2026-09', migration 641) the sole
-- source of truth for every real category it covers -- applied
-- unconditionally by benchmark_source_key prefix, regardless of the
-- row's current value (NULL, fabricated, or already-correct from 643 is a
-- harmless no-op). Categories with zero live rows (Generic Press, Material
-- Stock -- confirmed absent from this app's real data, per CLAUDE.md) are
-- included for completeness; their UPDATE simply matches nothing.
-- ============================================================================

UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE '2-Axis Router:%';
UPDATE mhr_records SET wage_grade = '4 - Metal' WHERE benchmark_source_key LIKE '2 Roll Bender:%';
UPDATE mhr_records SET wage_grade = '4 - Metal' WHERE benchmark_source_key LIKE '3 Roll Bender:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE '3D Laser Cutting Machine:%';
UPDATE mhr_records SET wage_grade = '4 - Metal' WHERE benchmark_source_key LIKE '4 Roll Bender:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Bend Press Brake:%';
UPDATE mhr_records SET wage_grade = '2 - Metal' WHERE benchmark_source_key LIKE 'Cut To Length Line (CTL):%';
UPDATE mhr_records SET wage_grade = '2 - Metal' WHERE benchmark_source_key LIKE 'Deslag Machine:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Fiber Laser Cutting Machine:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Generic Press:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Laser Cutting Machine:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Laser Punch / Punch Press:%';
UPDATE mhr_records SET wage_grade = '0 - Metal' WHERE benchmark_source_key LIKE 'Material Stock:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Oxyfuel Cutting Machine:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Plasma Cutting Machine:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Plasma Punch:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Progressive Die Press:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Shearing Machine:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Standard Press:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Tandem Press:%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Turret Press (Punch Press):%';
UPDATE mhr_records SET wage_grade = '3 - Metal' WHERE benchmark_source_key LIKE 'Waterjet Cutting Machine:%';

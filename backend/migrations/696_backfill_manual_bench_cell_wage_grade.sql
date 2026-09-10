-- ============================================================================
-- Migration 696: Backfill wage_grade for "Manual Bench Cell" rows
-- ============================================================================
-- Migration 695 deliberately left "Manual Bench Cell" unaliased to
-- "Bench Operation" (wage_grade_associations.json's real entry) as a
-- disclosed gap, not a guess -- the two source files (processes.json,
-- machiningusa.json) name this station differently.
--
-- Now confirmed with concrete evidence, not inferred: memory/machining/
-- processes.json's "Bench Operation" row has defaultMachine =
-- "Manual Bench Cell - 16m x 4m Footprint" -- an EXACT, literal string
-- match to one of the 4 real machine names staged under machiningusa.json's
-- "Manual Bench Cell" category (migration 693). Same real station, two
-- different literal category labels across the two source files -- not a
-- fuzzy name-similarity guess.
--
-- wage_grade_associations.json: "Bench Operation" -> "3 - Metal".
--
-- Only fills rows currently NULL, scoped to process_family = 'machined'
-- AND machine_class = 'manual_bench_cell' -- cannot touch any other row.
-- ============================================================================

UPDATE mhr_records
SET wage_grade = '3 - Metal'
WHERE process_family = 'machined'
  AND wage_grade IS NULL
  AND machine_class = 'manual_bench_cell';

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_class, wage_grade, count(*) FROM mhr_records
--   WHERE process_family = 'machined' GROUP BY machine_class, wage_grade ORDER BY machine_class;
-- -- Expect: all 12 categories now have a real wage_grade, none NULL.

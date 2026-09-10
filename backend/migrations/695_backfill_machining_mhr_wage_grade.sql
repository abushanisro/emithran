-- ============================================================================
-- Migration 695: Backfill mhr_records.wage_grade for migration 693's rows
-- ============================================================================
-- Real per-station wage-grade associations, source:
-- memory/machining/wage_grade_associations.json (43 real process -> required
-- labour grade rows, already losslessly staged as machining_reference_data
-- category='wage_grade' by migration 640 -- staging only at the time,
-- deliberately not promoted into any live table because its "N - Metal"
-- grade scale did not yet match what was live in mhr_records.wage_grade.
--
-- That blocker is gone: migration 649 (this session, wage-grade full
-- recoverage) already established "N - Metal" (0 - Metal, 2 - Metal,
-- 3 - Metal, 4 - Metal, ...) as the real, live, platform-wide
-- mhr_records.wage_grade convention -- confirmed directly against 649's
-- own SQL. Machining's source file uses the identical scale, so this is a
-- direct, compatible backfill, not a new mapping decision.
--
-- 11 of the 12 real station categories staged by migration 693 have a real
-- name match in wage_grade_associations.json. The 12th, "Manual Bench
-- Cell", does not -- the association file (which follows processes.json's
-- 43 station names) has no "Manual Bench Cell" entry; it has "Bench
-- Operation" instead (the same disclosed name mismatch migration 692's
-- header comment already flagged: processes.json's "Bench Operation"
-- station lists "Manual Bench Cell - ... Footprint" as its default
-- machine). Not aliased here -- left NULL, a disclosed gap, not a guess.
--
-- Only fills rows currently NULL, scoped to process_family = 'machined'
-- (migration 693's own unique marker) -- cannot touch any other row.
-- ============================================================================

UPDATE mhr_records
SET wage_grade = '5 - Metal'
WHERE process_family = 'machined'
  AND wage_grade IS NULL
  AND machine_class IN (
    '2_axis_bar_feed_lathe_with_sub_spindle',
    '2_axis_lathe',
    '3_axis_bar_feed_lathe_with_sub_spindle',
    '3_axis_lathe',
    '3_axis_mill',
    '3_axis_router',
    '4_axis_mill',
    '5_axis_mill',
    '5_axis_router'
  );

UPDATE mhr_records
SET wage_grade = '2 - Metal'
WHERE process_family = 'machined'
  AND wage_grade IS NULL
  AND machine_class = 'automated_deburr';

UPDATE mhr_records
SET wage_grade = '3 - Metal'
WHERE process_family = 'machined'
  AND wage_grade IS NULL
  AND machine_class = 'bevel_gear_cutting_machine';

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after):
-- SELECT machine_class, wage_grade, count(*) FROM mhr_records
--   WHERE process_family = 'machined' GROUP BY machine_class, wage_grade ORDER BY machine_class;
-- -- Expect: every machine_class has a real wage_grade EXCEPT manual_bench_cell (stays NULL, disclosed gap).

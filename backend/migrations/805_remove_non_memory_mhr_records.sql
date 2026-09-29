-- ============================================================================
-- Migration 805: Remove every mhr_records row that is not backed by the
-- memory/ reference exports
--
-- User decision (2026-09-27): memory/ holds all the real machine data; every
-- other HR Rates row is old and is to be removed.
--
-- "Backed by memory/" = the row carries benchmark_source_key
-- ("<Category>:<Machine>"), which every memory/-sourced seed stamps
-- (564-598, 693, 738, 758, 793-797; 734 backfilled it for the Injection
-- Molding fleet seeded by 633). Rows without it came from researched or
-- placeholder seeds with no memory/ source: 365, 393 (tapping), 407/409
-- (hole forming), 445 (India SM-* generic placeholders), 465/466 (PEM
-- Insertion Press, a web-researched rate, 10 locations each listed twice),
-- 491 (should-cost report rates), plus early Excel imports and manual entries.
--
-- Run backend/migrations/scripts/preview_805_remove_non_memory_mhr_records.sql
-- FIRST and review P1-P6. P3 lists every (machine_class, location) that will
-- have no machine left - lines on those price that machine at 0 with the
-- existing "no MHR rate on file" warning, never a made-up rate.
--
-- Two tables store an mhr_records id with no foreign key, so they are
-- handled explicitly instead of being left pointing at nothing:
--   process_cost_records.mhr_id    -> set NULL (line keeps its own
--                                     machine_name / machine_rate snapshot;
--                                     historic cost unchanged)
--   bom_item_machine_overrides     -> override row deleted (an override to a
--                                     machine that no longer exists cannot be
--                                     honoured)
-- Both also cover links that were ALREADY orphaned before this migration.
-- The one real FK (migration 324, ON DELETE SET NULL) handles itself.
--
-- Written as ONE DO block: the SQL editor runs each statement on its own,
-- so a temp table or a BEGIN/COMMIT pair spanning statements does not
-- survive between them. A single DO block is one statement and is atomic -
-- any RAISE EXCEPTION rolls back everything it did.
-- ============================================================================

DO $$
DECLARE
  n_im         integer;
  n_kept       integer;
  n_delete     integer;
  n_lines      integer;
  n_overrides  integer;
  n_deleted    integer;
BEGIN
  SELECT count(*) INTO n_delete
  FROM mhr_records
  WHERE nullif(trim(benchmark_source_key), '') IS NULL;

  -- Guard: the Injection Molding fleet is real memory/ data. If any of it is
  -- still unkeyed, migration 734 did not fully apply - stop, delete nothing.
  SELECT count(*) INTO n_im
  FROM mhr_records
  WHERE nullif(trim(benchmark_source_key), '') IS NULL
    AND machine_class IN ('injection_molding', 'compression_molding',
                          'structural_foam_molding', 'reaction_injection_molding');
  IF n_im > 0 THEN
    RAISE EXCEPTION 'Migration 805 aborted: % Injection Molding rows have no benchmark_source_key (run migration 734 first)', n_im;
  END IF;

  -- Guard: never empty the table. A memory/-backed pool must remain.
  SELECT count(*) INTO n_kept
  FROM mhr_records
  WHERE nullif(trim(benchmark_source_key), '') IS NOT NULL;
  IF n_kept = 0 THEN
    RAISE EXCEPTION 'Migration 805 aborted: no memory/-backed mhr_records rows would remain';
  END IF;

  -- Clear process-line links to machines being deleted or already missing.
  UPDATE process_cost_records pcr
  SET mhr_id = NULL
  WHERE pcr.mhr_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM mhr_records m
      WHERE m.id::text = pcr.mhr_id::text
        AND nullif(trim(m.benchmark_source_key), '') IS NOT NULL);
  GET DIAGNOSTICS n_lines = ROW_COUNT;

  -- Remove per-part machine overrides to machines being deleted or missing.
  DELETE FROM bom_item_machine_overrides o
  WHERE NOT EXISTS (
    SELECT 1 FROM mhr_records m
    WHERE m.id::text = o.mhr_record_id::text
      AND nullif(trim(m.benchmark_source_key), '') IS NOT NULL);
  GET DIAGNOSTICS n_overrides = ROW_COUNT;

  DELETE FROM mhr_records
  WHERE nullif(trim(benchmark_source_key), '') IS NULL;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;

  RAISE NOTICE 'Migration 805: deleted % mhr_records rows (expected %), kept %, cleared % process-line links, removed % machine overrides',
    n_deleted, n_delete, n_kept, n_lines, n_overrides;
END $$;

-- Verify afterwards (expect 0, 0, 0):
-- SELECT count(*) FROM mhr_records WHERE nullif(trim(benchmark_source_key), '') IS NULL;
-- SELECT count(*) FROM process_cost_records pcr WHERE pcr.mhr_id IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM mhr_records m WHERE m.id::text = pcr.mhr_id::text);
-- SELECT count(*) FROM bom_item_machine_overrides o
--   WHERE NOT EXISTS (SELECT 1 FROM mhr_records m WHERE m.id::text = o.mhr_record_id::text);

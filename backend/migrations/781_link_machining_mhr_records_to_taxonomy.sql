-- ============================================================================
-- Migration 781: Link Machining mhr_records rows to process_taxonomy
-- (the "Pass 3" migration 611 named but never wrote)
-- ============================================================================
-- migration 611 ("Pass 1") only linked mhr_records -> process_taxonomy for
-- process_group = 'Sheet Metal', joined on mr.operation = pt.process_name --
-- confirmed by direct read of 611's own header, which explicitly names an
-- unwritten "Pass 3 (unambiguous machine_class fallback)" for exactly this
-- situation. It was never executed for Machining. Migration 693's 141 real
-- Machining rows have sat with canonical_process_id = NULL ever since.
--
-- This is load-bearing for the Machining re-architecture plan (Section G.1,
-- C:\Users\singi\.claude\plans\logical-noodling-lampson.md): the dynamic
-- "discover eligible machine classes" query joins mhr_records to
-- process_taxonomy through this FK to read machining_route_role (migration
-- 780). Without this backfill, that join returns nothing for Machining.
--
-- WHY JOIN ON benchmark_source_key, NOT machine_class
--
-- process_taxonomy.machine_class is NULL for every Machining row (never
-- backfilled -- migration 725's Part A.1 only backfills from ACTIVE
-- process_calculator_mappings rows, and every Machining mapping row from
-- migration 691 is is_active=false). mhr_records has no operation column
-- populated for Machining rows either. But migration 693's own seed data
-- gives every row a benchmark_source_key of the exact form
-- "{ProcessName}:{MachineName}" (e.g. "3 Axis Mill:Haas VF10/50") --
-- confirmed directly against migration 693's INSERT values. The process-
-- name half of that string is a verbatim, exact match against
-- process_taxonomy.process_name for the same 43-row Machining taxonomy
-- migration 691 seeded. This is a real, sourced, unambiguous key -- not a
-- guessed alias rule.
--
-- Idempotent: backfill only touches canonical_process_id IS NULL rows;
-- CREATE OR REPLACE + DROP TRIGGER IF EXISTS make the trigger safe to rerun.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

BEGIN;

-- ── One-time backfill ────────────────────────────────────────────────────
UPDATE mhr_records mr
SET canonical_process_id = pt.id
FROM process_taxonomy pt
WHERE mr.canonical_process_id IS NULL
  AND mr.process_group = 'Machining'
  AND pt.process_group = 'Machining'
  AND pt.process_name = split_part(mr.benchmark_source_key, ':', 1);

-- ── Keep it synced going forward for newly-onboarded Machining machines ────
-- Mirrors migration 725's Part A.3 sync-trigger pattern, scoped to
-- Machining only (the one process group whose canonical_process_id was
-- never wired at insert time -- Sheet Metal/Plastic Molding rows already
-- get canonical_process_id set correctly by other paths).
CREATE OR REPLACE FUNCTION sync_machining_mhr_canonical_process_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.process_group = 'Machining'
     AND NEW.canonical_process_id IS NULL
     AND NEW.benchmark_source_key IS NOT NULL THEN
    UPDATE mhr_records
    SET canonical_process_id = pt.id
    FROM process_taxonomy pt
    WHERE mhr_records.id = NEW.id
      AND pt.process_group = 'Machining'
      AND pt.process_name = split_part(NEW.benchmark_source_key, ':', 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_machining_mhr_canonical_process_id ON mhr_records;
CREATE TRIGGER trigger_sync_machining_mhr_canonical_process_id
  AFTER INSERT OR UPDATE OF process_group, benchmark_source_key, canonical_process_id ON mhr_records
  FOR EACH ROW
  EXECUTE FUNCTION sync_machining_mhr_canonical_process_id();

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM mhr_records WHERE process_group = 'Machining' AND canonical_process_id IS NOT NULL; -- expect 141
-- SELECT count(*) FROM mhr_records WHERE process_group = 'Machining' AND canonical_process_id IS NULL; -- expect 0

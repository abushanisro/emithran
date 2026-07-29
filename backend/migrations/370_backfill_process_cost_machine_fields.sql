-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 370: Backfill machine_name/machine_class on existing process_cost_records
--
-- Bug A fix (process-cost.service.ts) only affects rows created/updated AFTER the
-- code fix ships. Existing rows saved via the ProcessCostDialog before that point
-- have mhr_id populated but machine_name/machine_class NULL (368's original gap).
-- This is a one-time catch-up: join through mhr_id -> mhr_records and copy over
-- the machine_name/machine_class that should have been stored at write time.
--
-- Rows with NO mhr_id (flat manual-rate entries, no machine ever selected) are
-- correctly left NULL — that is not a gap, it's a legitimate state.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE process_cost_records pcr
SET machine_name  = mhr.machine_name,
    machine_class = mhr.machine_class
FROM mhr_records mhr
WHERE pcr.mhr_id = mhr.id
  AND pcr.machine_name IS NULL;

-- ── Diagnostic (non-fatal — orphaned mhr_id references are a separate,
-- pre-existing data-integrity concern and are intentionally NOT hard-failed
-- here) ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM process_cost_records
  WHERE mhr_id IS NOT NULL AND machine_name IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE
      'Migration 370: % process_cost_records row(s) have mhr_id set but no matching mhr_records row (orphaned reference) — machine_name left NULL for these.',
      orphan_count;
  END IF;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM process_cost_records WHERE mhr_id IS NOT NULL AND machine_name IS NULL;
-- Expected: 0, or a small count of orphaned mhr_id references (see NOTICE above).

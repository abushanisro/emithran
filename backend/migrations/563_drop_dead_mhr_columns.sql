-- ============================================================================
-- Migration 563: Drop dead mhr_records columns
--
-- Four mhr_records columns are confirmed write-only/dead — verified against
-- cost-engine.ts, machine-selection/selector.ts, and every DTO/UI consumer
-- during the HR Rates / MHR cleanup initiative:
--   - process_category   — a naming collision with the unrelated
--     `processes.process_category` column; on mhr_records itself it is only
--     ever written (create/update/import), never read for any decision.
--   - capability_version — written on every capability write (migration 324's
--     convention, mirroring economics_version) but never branched on anywhere
--     — pure passthrough metadata, not load-bearing.
--   - lhr_usd_effective  — write-only on mhr_records (set by importFromExcel
--     only). Name collision only with `lhr_benchmark_rates.lhr_usd_effective`,
--     a DIFFERENT table's column that IS heavily read (bom-items.service.ts,
--     location-comparison.service.ts, lhr.service.ts) — this migration does
--     NOT touch lhr_benchmark_rates, only mhr_records.
--   - specs (jsonb)      — category-specific machine_library.json detail with
--     no dedicated column, staged here on import, but never read by any live
--     calculation. Replaced by a read-only join to sm_reference_data (see
--     mhr.service.ts's new getReferenceDetail() / GET /mhr/:id/reference-detail)
--     instead of duplicating that data onto mhr_records.
--
-- Pre-check: verified live (not just via grep — this repo's mhr_records
-- history has multiple columns/indexes that predate the tracked migrations/
-- layout, same situation migration 536 already documented) that exactly one
-- index depends on any of these four columns: idx_mhr_specs_gin, a
-- single-column `USING gin (specs)` index with no other column in it.
-- PostgreSQL auto-drops an index when the column(s) it's defined can be
-- solely attributed to are dropped — no separate DROP INDEX needed, and no
-- data-loss concern beyond specs' own removal, which is the point of this
-- migration. The DO block below still aborts on anything else unexpected
-- (e.g. a composite index mixing a dead column with a live one), rather
-- than assuming every future dependent index is equally safe.
-- ============================================================================

DO $$
DECLARE
  dependent_count INTEGER;
  idx RECORD;
BEGIN
  SELECT COUNT(*) INTO dependent_count
  FROM pg_indexes
  WHERE tablename = 'mhr_records'
    AND indexname != 'idx_mhr_specs_gin'  -- confirmed single-column `USING gin (specs)` — safe, see header
    AND (indexdef ILIKE '%process_category%'
      OR indexdef ILIKE '%capability_version%'
      OR indexdef ILIKE '%lhr_usd_effective%'
      OR indexdef ILIKE '%specs%');

  IF dependent_count > 0 THEN
    FOR idx IN
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'mhr_records'
        AND indexname != 'idx_mhr_specs_gin'
        AND (indexdef ILIKE '%process_category%'
          OR indexdef ILIKE '%capability_version%'
          OR indexdef ILIKE '%lhr_usd_effective%'
          OR indexdef ILIKE '%specs%')
    LOOP
      RAISE NOTICE 'Dependent index: % -> %', idx.indexname, idx.indexdef;
    END LOOP;

    RAISE EXCEPTION 'Migration 563 aborted: % index(es) on mhr_records reference one of the columns being dropped — see NOTICE output above for exact index name/definition.', dependent_count;
  END IF;
END $$;

ALTER TABLE mhr_records
  DROP COLUMN IF EXISTS process_category,
  DROP COLUMN IF EXISTS capability_version,
  DROP COLUMN IF EXISTS lhr_usd_effective,
  DROP COLUMN IF EXISTS specs;

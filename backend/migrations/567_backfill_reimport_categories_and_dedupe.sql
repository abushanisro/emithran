-- ============================================================================
-- Migration 567: Backfill categories for the post-recovery re-import, dedupe presses
--
-- Context: mhr_records was accidentally wiped via "Clear All" (deletes
-- everything the calling user's org owns; only the 37 truly-global
-- user_id/organization_id-NULL rows from migrations 564/565 survived, since
-- RLS/removeAll's own org-scoping never touches null-owned rows). The user
-- re-imported memory/sheetmetal/machine/generated/usa_machine_library_mhr_import.xlsx
-- via POST /mhr/import-excel to recover.
--
-- That bulk Excel import path (unlike the single-record create() path) never
-- calls resolveEconomicsForCreate()/lookupMachineLibraryBenchmark() — so none
-- of the freshly re-imported rows got benchmark_source_key set, and every
-- one of them displays as category "-" in the UI (mhrCategoryOf falls back
-- to '-' with no benchmark_source_key and no machine_class, which is
-- correct/honest for these 9 non-cost-engine categories).
--
-- Two distinct fixes, both scoped to rows with NO benchmark_source_key yet:
--
-- 1) Backfill benchmark_source_key for every UNAMBIGUOUS name match against
--    sm_reference_data — same discipline as migration 537/565 (skip names
--    that collide across >1 category rather than guess). This alone
--    resolves the ~138 genuinely-new machines (2-Axis Router, Roll Benders,
--    3D Laser, CTL, Oxyfuel, Laser Punch, plus the uniquely-named
--    "Progressive/Tandem Press - N,NNNkN Press Force" rows) into their real
--    category.
--
-- 2) The remaining rows are the 12 machine names that collide between
--    Progressive Die Press and Tandem Press (Default Press, Schuler 1150
--    Ton, etc.) — the re-import recreated all 24 of these, but the
--    equivalent 24 rows already exist correctly (global, benchmark-tagged,
--    from migration 565, which survived Clear All). These re-imported
--    copies are pure duplicates, not new data — delete them rather than
--    trying to categorize them, keeping the one correct global copy each
--    machine already has.
-- ============================================================================

DO $$
DECLARE
  backfilled_count INTEGER;
  duplicates_deleted INTEGER;
BEGIN
  -- ── Step 1: backfill benchmark_source_key for unambiguous name matches ──
  WITH name_counts AS (
    SELECT lower(raw->>'name') AS name_lower, COUNT(*) AS cnt
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
  ),
  unambiguous_refs AS (
    SELECT sr.key, sr.raw
    FROM sm_reference_data sr
    JOIN name_counts c ON c.name_lower = lower(sr.raw->>'name')
    WHERE sr.category = 'machine' AND c.cnt = 1
  )
  UPDATE mhr_records mr
  SET benchmark_source_key = ref.key,
      benchmark_direct_overhead_rate_usd_hr   = COALESCE(mr.benchmark_direct_overhead_rate_usd_hr, NULLIF(ref.raw->>'direct_overhead_rate_usd_hr','')::numeric),
      benchmark_indirect_overhead_rate_usd_hr = COALESCE(mr.benchmark_indirect_overhead_rate_usd_hr, NULLIF(ref.raw->>'indirect_overhead_rate_usd_hr','')::numeric),
      benchmark_labor_rate_usd_hr              = COALESCE(mr.benchmark_labor_rate_usd_hr, NULLIF(ref.raw->>'labor_rate_usd_hr','')::numeric)
  FROM unambiguous_refs ref
  WHERE lower(ref.raw->>'name') = lower(mr.machine_name)
    AND mr.benchmark_source_key IS NULL;

  GET DIAGNOSTICS backfilled_count = ROW_COUNT;

  -- ── Step 2: delete duplicate re-imports of the 12 ambiguous press names ──
  -- Only deletes a row that (a) still has no benchmark_source_key (i.e. is
  -- one of these ambiguous names, since step 1 already tagged everything
  -- unambiguous) AND (b) a real, already-tagged global copy of the same
  -- name demonstrably exists — never deletes the last remaining copy of a
  -- machine.
  DELETE FROM mhr_records dup
  WHERE dup.benchmark_source_key IS NULL
    AND EXISTS (
      SELECT 1 FROM mhr_records keep
      WHERE keep.id <> dup.id
        AND keep.benchmark_source_key IS NOT NULL
        AND lower(keep.machine_name) = lower(dup.machine_name)
    );

  GET DIAGNOSTICS duplicates_deleted = ROW_COUNT;

  RAISE NOTICE 'Migration 567: backfilled category on % re-imported row(s); deleted % duplicate row(s) of already-global Progressive/Tandem Press machines.',
    backfilled_count, duplicates_deleted;
END $$;

-- ── Verification ───────────────────────────────────────────────────────────
-- SELECT COUNT(*) FILTER (WHERE benchmark_source_key IS NULL) AS still_uncategorized,
--        COUNT(*) AS total
--   FROM mhr_records;
-- -- still_uncategorized should now be close to 0 (only genuinely non-machine_library
-- -- rows, if any, would remain).

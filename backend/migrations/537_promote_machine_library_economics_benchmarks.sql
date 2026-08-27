-- ============================================================================
-- Migration 537: Promote machine_library.json economics into benchmark_* columns
-- Purpose: Populates the benchmark lane added by migration 536, from the
--          machine_library.json data already lossless-staged in sm_reference_data
--          (category='machine', migrations 505-508). Follows the exact
--          case-insensitive exact-name-match, idempotent, service-role UPDATE
--          pattern already used by migrations 509 (fiber laser power), 510
--          (press brake tonnage), 511 (waterjet), and 532 (turret punch
--          capability) — never creates a new mhr_records row, only backfills
--          a NULL benchmark_* column on a row a real customer/import already
--          created (same "promotion never fabricates a row" discipline cited
--          in migration 479's own header).
--
--          Sets benchmark_source_key in the SAME statement that sets the
--          numeric benchmark columns — migration 535 had to clean up after
--          480/510 backfilled tonnage without labeling capability_source in
--          the same statement; this migration does not repeat that mistake.
--
--          machine_library.json has 12 machine names that appear twice
--          across different categories (e.g. "Schuler 1150 Ton" in both
--          Progressive Die Press and Tandem Press). An exact-name match
--          against such a name is genuinely ambiguous — this migration
--          deliberately SKIPS ambiguous names rather than guessing which
--          variant applies, and reports them via RAISE NOTICE so a future,
--          more specific migration can resolve them using machine_class.
-- Author: Principal Engineering Team
-- Date: 2026-08-22
-- Version: 1.0.0
-- ============================================================================

DO $$
DECLARE
  matched_count     INTEGER;
  ambiguous_count    INTEGER;
  total_ref_machines INTEGER;
BEGIN
  -- Unambiguous matches only: exactly one sm_reference_data machine row for this name.
  WITH machine_name_counts AS (
    SELECT lower(raw->>'name') AS name_lower, COUNT(*) AS cnt
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
  ),
  unambiguous_refs AS (
    SELECT sr.key, sr.raw
    FROM sm_reference_data sr
    JOIN machine_name_counts c ON c.name_lower = lower(sr.raw->>'name')
    WHERE sr.category = 'machine' AND c.cnt = 1
  )
  UPDATE mhr_records mr
  SET benchmark_direct_overhead_rate_usd_hr   = (ref.raw->>'direct_overhead_rate_usd_hr')::numeric,
      benchmark_indirect_overhead_rate_usd_hr = (ref.raw->>'indirect_overhead_rate_usd_hr')::numeric,
      benchmark_labor_rate_usd_hr              = (ref.raw->>'labor_rate_usd_hr')::numeric,
      benchmark_source_key                     = ref.key
  FROM unambiguous_refs ref
  WHERE lower(ref.raw->>'name') = lower(mr.machine_name)
    AND mr.benchmark_direct_overhead_rate_usd_hr IS NULL;

  GET DIAGNOSTICS matched_count = ROW_COUNT;

  SELECT COUNT(*) INTO total_ref_machines FROM sm_reference_data WHERE category = 'machine';

  SELECT COUNT(*) INTO ambiguous_count
  FROM (
    SELECT lower(raw->>'name') AS n
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
    HAVING COUNT(*) > 1
  ) dup;

  RAISE NOTICE 'Migration 537: promoted economics benchmarks onto % mhr_records row(s) out of % staged machine_library rows (% ambiguous name(s) skipped — see migration header).',
    matched_count, total_ref_machines, ambiguous_count;
END $$;

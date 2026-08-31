-- ============================================================================
-- Migration 603: Allow the new 'no_rate' economics provenance tag
--
-- Root cause fixed (2026-08-30): economics-resolver.ts's resolveOneRate()
-- previously returned a FABRICATED $0 (GENERIC_FALLBACK_OVERHEAD_USD_HR /
-- GENERIC_FALLBACK_LABOR_RATE_USD_HR, both hardcoded to 0) tagged
-- 'generic_fallback' whenever a machine had no real value AND no benchmark
-- match for direct overhead / indirect overhead / labor rate. That $0 was
-- then persisted straight into mhr_records.direct_overhead_rate /
-- indirect_overhead_rate / usd_lhr_total as if it were a real rate.
--
-- The resolver now returns value: null, source: 'no_rate' for that same
-- "nothing on file" case — never a fabricated number. mhr.service.ts's
-- create()/update() now refuse to persist a machine-hour rate computed from
-- a null component (BadRequestException with an actionable message) instead
-- of silently zero-filling it.
--
-- This migration only WIDENS the three CHECK constraints (migration 536) to
-- also allow 'no_rate' — purely additive, per this repo's rollback strategy
-- (never a destructive migration on mhr_records). 'generic_fallback' stays
-- allowed too: it is not backfilled or removed from any historical row here
-- — those rows keep whatever value/tag they already have; only NEW
-- create()/update() calls will ever produce 'no_rate' going forward.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_direct_overhead_source_check') THEN
    ALTER TABLE mhr_records DROP CONSTRAINT mhr_records_direct_overhead_source_check;
  END IF;
  ALTER TABLE mhr_records
    ADD CONSTRAINT mhr_records_direct_overhead_source_check
    CHECK (direct_overhead_source IS NULL OR direct_overhead_source IN (
      'shop_override', 'imported', 'benchmark', 'generic_fallback', 'no_rate'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_indirect_overhead_source_check') THEN
    ALTER TABLE mhr_records DROP CONSTRAINT mhr_records_indirect_overhead_source_check;
  END IF;
  ALTER TABLE mhr_records
    ADD CONSTRAINT mhr_records_indirect_overhead_source_check
    CHECK (indirect_overhead_source IS NULL OR indirect_overhead_source IN (
      'shop_override', 'imported', 'benchmark', 'generic_fallback', 'no_rate'
    ));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_labor_rate_source_check') THEN
    ALTER TABLE mhr_records DROP CONSTRAINT mhr_records_labor_rate_source_check;
  END IF;
  ALTER TABLE mhr_records
    ADD CONSTRAINT mhr_records_labor_rate_source_check
    CHECK (labor_rate_source IS NULL OR labor_rate_source IN (
      'shop_override', 'imported', 'benchmark', 'generic_fallback', 'no_rate',
      'lhr_shop_avg', 'lhr_benchmark'
    ));
END $$;

COMMENT ON COLUMN mhr_records.direct_overhead_source IS
  'Provenance tier for direct_overhead_rate: shop_override (human-entered) | imported (Excel bulk import) | benchmark (machine_library.json promotion, migration 537) | no_rate (no real value or benchmark on file — direct_overhead_rate is NULL, never fabricated; economics-resolver.ts, 2026-08-30) | generic_fallback (legacy tag on rows saved before 2026-08-30, when this resolved to a fabricated $0 instead of NULL). Mirrors capability_source''s existing tiering (migration 324) for the economics domain.';
COMMENT ON COLUMN mhr_records.indirect_overhead_source IS 'Same tiering as direct_overhead_source, for indirect_overhead_rate.';
COMMENT ON COLUMN mhr_records.labor_rate_source IS
  'Provenance for usd_lhr_total (the Rate Table''s displayed Skill Rate). ''lhr_shop_avg''/''lhr_benchmark'' mean it was resolved from lhr_records/lhr_benchmark_rates by (location, process_group) — the same tables/precedence bom-items.service.ts''s resolveLHRRates() uses for real quote costing (this lane was finally wired up in mhr.service.ts on 2026-08-30 — migration 568 had already reserved these tags but nothing ever produced them until now). ''no_rate'' means no LHR data and no legacy sm_reference_data benchmark existed either — usd_lhr_total is NULL, never fabricated. ''benchmark''/''generic_fallback'' are the older, pre-LHR-wiring tags (generic_fallback additionally predates the null-not-zero fix).';

-- Verification:
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname IN ('mhr_records_direct_overhead_source_check', 'mhr_records_indirect_overhead_source_check', 'mhr_records_labor_rate_source_check');
-- Expect all three to include 'no_rate' in their allowed list.

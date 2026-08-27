-- ============================================================================
-- Migration 568: Allow the new LHR-resolved labor_rate_source tags
--
-- Context: mhr_records.labor_rate_source (migration 536) only allowed
-- 'shop_override' | 'imported' | 'benchmark' | 'generic_fallback' — all
-- describing the OLD per-machine sm_reference_data benchmark lane, which
-- economics-resolver.ts's own header comment already flagged as disconnected
-- from the real quote-costing engine (bom-items.service.ts's resolveLHRRates,
-- which resolves labor rate from lhr_records/lhr_benchmark_rates keyed by
-- (location, process_group)).
--
-- mhr.service.ts now resolves the MHR form's "Skill Rate" the same way real
-- costing does — via the new LHRService.getEffectiveRate() — before falling
-- back to the old machine_library benchmark lane. Two new source tags record
-- which lane actually won:
--   'lhr_shop_avg'  — averaged from this shop's own lhr_records for the
--                     resolved (location, process_group)
--   'lhr_benchmark' — no shop lhr_records on file; fell back to
--                     lhr_benchmark_rates for that same (location, process_group)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_labor_rate_source_check') THEN
    ALTER TABLE mhr_records DROP CONSTRAINT mhr_records_labor_rate_source_check;
  END IF;

  ALTER TABLE mhr_records
    ADD CONSTRAINT mhr_records_labor_rate_source_check
    CHECK (labor_rate_source IS NULL OR labor_rate_source IN (
      'shop_override', 'imported', 'benchmark', 'generic_fallback',
      'lhr_shop_avg', 'lhr_benchmark'
    ));
END $$;

COMMENT ON COLUMN mhr_records.labor_rate_source IS
  'Provenance for usd_lhr_total (the Rate Table''s displayed Skill Rate). '
  '''lhr_shop_avg''/''lhr_benchmark'' mean it was resolved from lhr_records/'
  'lhr_benchmark_rates by (location, process_group) — the same tables/'
  'precedence bom-items.service.ts''s resolveLHRRates() uses for real quote '
  'costing, so this value now matches what a quote will actually charge in '
  'the common case. The older ''benchmark''/''generic_fallback'' tags mean no '
  'LHR data existed for that process group and the legacy per-machine '
  'sm_reference_data lane (or the flat 0 fallback) was used instead.';

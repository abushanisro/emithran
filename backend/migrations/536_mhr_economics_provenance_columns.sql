-- ============================================================================
-- Migration 536: Economics provenance columns on mhr_records
-- Purpose: Phase 1 of the "Machine Economics" architecture initiative (see
--          CLAUDE.md, 2026-08-22) — give direct/indirect overhead and labor
--          rate the exact same provenance treatment mhr_records.capability_source
--          already gives machine CAPABILITY (migration 324): a source tier
--          per field, plus a separate benchmark_* lane that a reference-data
--          promotion can populate WITHOUT ever overwriting a real shop/import
--          value living in the existing direct_overhead_rate/indirect_overhead_rate/
--          usd_lhr_total columns.
--
--          Four real, honestly-backed tiers (not the full 5-tier chain named
--          in CLAUDE.md — 'approved company benchmark' has no backing schema
--          yet, since mhr_records is genuinely per-auth.users, not per-org):
--            'shop_override'    — a human explicitly entered/confirmed this
--                                 value via the MHR create/update API.
--            'imported'         — arrived via the Excel bulk-import path.
--            'benchmark'        — filled from sm_reference_data (machine_library.json)
--                                 by migration 537, only when neither of the
--                                 above ever set a value.
--            'generic_fallback' — last resort, applied in application code
--                                 (economics-resolver.ts) when nothing above
--                                 is on file; no DB value, so no enum row needed
--                                 for it here beyond allowing it to be *read*
--                                 (the column itself is set by the app, not
--                                 written by this migration).
--
--          direct_overhead_rate/indirect_overhead_rate/usd_lhr_total are the
--          EXISTING columns (migrations 130/131, predates this repo's current
--          migrations/ layout) — this migration does not touch them, only adds
--          the source tags and the separate benchmark_* lane.
-- Author: Principal Engineering Team
-- Date: 2026-08-22
-- Version: 1.0.0
-- ============================================================================

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS direct_overhead_source   VARCHAR(24),
  ADD COLUMN IF NOT EXISTS indirect_overhead_source  VARCHAR(24),
  ADD COLUMN IF NOT EXISTS labor_rate_source         VARCHAR(24),
  ADD COLUMN IF NOT EXISTS economics_version         INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS economics_updated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS economics_updated_by      UUID,
  -- Industry-benchmark lane (machine_library.json, via sm_reference_data,
  -- promoted by migration 537) — deliberately separate columns from the real
  -- direct_overhead_rate/indirect_overhead_rate/usd_lhr_total so a benchmark
  -- promotion can NEVER silently overwrite a real shop/imported value.
  ADD COLUMN IF NOT EXISTS benchmark_direct_overhead_rate_usd_hr    NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS benchmark_indirect_overhead_rate_usd_hr  NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS benchmark_labor_rate_usd_hr              NUMERIC(10, 4),
  ADD COLUMN IF NOT EXISTS benchmark_source_key                    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_direct_overhead_source_check') THEN
    ALTER TABLE mhr_records
      ADD CONSTRAINT mhr_records_direct_overhead_source_check
      CHECK (direct_overhead_source IS NULL OR direct_overhead_source IN ('shop_override', 'imported', 'benchmark', 'generic_fallback'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_indirect_overhead_source_check') THEN
    ALTER TABLE mhr_records
      ADD CONSTRAINT mhr_records_indirect_overhead_source_check
      CHECK (indirect_overhead_source IS NULL OR indirect_overhead_source IN ('shop_override', 'imported', 'benchmark', 'generic_fallback'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mhr_records_labor_rate_source_check') THEN
    ALTER TABLE mhr_records
      ADD CONSTRAINT mhr_records_labor_rate_source_check
      CHECK (labor_rate_source IS NULL OR labor_rate_source IN ('shop_override', 'imported', 'benchmark', 'generic_fallback'));
  END IF;
END $$;

COMMENT ON COLUMN mhr_records.direct_overhead_source IS
  'Provenance tier for direct_overhead_rate: shop_override (human-entered) | imported (Excel bulk import) | benchmark (machine_library.json promotion, migration 537) | generic_fallback (app-level last resort, not persisted by any migration). Mirrors capability_source''s existing tiering (migration 324) for the economics domain.';
COMMENT ON COLUMN mhr_records.indirect_overhead_source IS 'Same tiering as direct_overhead_source, for indirect_overhead_rate.';
COMMENT ON COLUMN mhr_records.labor_rate_source IS 'Same tiering as direct_overhead_source, for usd_lhr_total (the Rate Table''s displayed labor rate — see economics-resolver.ts''s doc comment for why this is NOT the same value real quote costing uses today).';
COMMENT ON COLUMN mhr_records.benchmark_direct_overhead_rate_usd_hr IS
  'Reference/industry-benchmark value from sm_reference_data (category=machine, i.e. machine_library.json), populated by migration 537''s name-matched promotion. Never overwritten by a later promotion once populated; never overwrites direct_overhead_rate.';
COMMENT ON COLUMN mhr_records.benchmark_source_key IS 'sm_reference_data.key this row was matched to, for audit.';

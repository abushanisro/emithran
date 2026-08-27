-- ============================================================================
-- Migration 412: sm_lookup_inspection_time — Table 7 of the sheet-metal
-- lookup-table series (migration 300 seeded Tables 1-6; this was never built).
-- ============================================================================
-- Root cause: CostEngineInput.inspectionTimeMin had a `= 0.5` default
-- parameter in cost-engine.ts's eMithranTerms() call sites, but NO caller in
-- bom-items.service.ts ever resolved/passed a real value for it — unlike its
-- siblings (handlingTimeMin ← Table 2, toolSetupBrakeMin ← Table 3B,
-- samplingRate ← Table 6, all resolved via SheetMetalLookupService before
-- calling computeCostSummary). Every sheet-metal quote's per-piece inspection
-- cost was therefore silently built on a flat 0.5-minute constant with zero
-- DB backing and no warning — a true silent fallback, not a disclosed one.
--
-- This migration does not introduce new engineering data: it moves the
-- existing 0.5-minute constant into a real, admin-editable table so it stops
-- being buried in code, and gives the code a designated place to disclose
-- when it's still using that default (bom-items.service.ts now pushes an
-- explicit "seed sm_lookup_inspection_time" warning when no row is found,
-- same pattern as Tables 2/3B/4/6). The three complexity tiers mirror the
-- 'simple'/'inter'/'complex' vocabulary already used by Table 6
-- (sm_lookup_sampling_plan's sample_qty_l1/l2/l3) and by bom-items.service.ts's
-- own smComplexity/lookupComplexity resolution (previously computed but never
-- consumed by anything — this migration is also what finally uses it).
--
-- All three tiers are seeded with the SAME value (0.5 min) on purpose — this
-- is an honest migration of the current uniform constant, not a fabricated
-- claim that complex parts have been measured to take longer to inspect.
-- The schema supports differentiating the tiers once a real time study exists;
-- until then, uniform seed data is the truthful starting point.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_inspection_time (
    id              SERIAL PRIMARY KEY,
    complexity      VARCHAR(10) NOT NULL,      -- 'simple' | 'inter' | 'complex'
    inspection_min  NUMERIC NOT NULL,          -- per-piece dimensional/visual check time (min)
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_inspection_time_complexity ON sm_lookup_inspection_time(complexity);

ALTER TABLE sm_lookup_inspection_time ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON sm_lookup_inspection_time;
CREATE POLICY "Public read" ON sm_lookup_inspection_time FOR SELECT USING (true);

COMMENT ON TABLE sm_lookup_inspection_time IS 'Table 7: Per-piece dimensional/visual inspection time (min) by part complexity tier — see migration 412 for why this table exists';

INSERT INTO sm_lookup_inspection_time (complexity, inspection_min) VALUES
  ('simple',  0.5),
  ('inter',   0.5),
  ('complex', 0.5)
ON CONFLICT (complexity) DO NOTHING;

-- Verification:
-- SELECT complexity, inspection_min FROM sm_lookup_inspection_time ORDER BY complexity;
-- Should return 3 rows.

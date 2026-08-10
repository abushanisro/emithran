-- ============================================================================
-- Migration 423: inspection_operation_defaults — one extensible table for the
-- new general-purpose Inspection cost line, not one table per concept.
-- ============================================================================
-- Root cause this fixes: the Manufacturing Process tree already shows an
-- "Inspection" step for every sheet-metal part (autoCompleteRoute pushes it
-- unconditionally), but there was no general-purpose cost line behind it —
-- the only real inspection line that existed (cost-engine.ts's old tight-
-- tolerance-reaming CMM block) fired only for that one narrow case, so almost
-- every part's "Inspection" tree node had no matching cost.processLines entry
-- and showed no dollar amount.
--
-- Deliberately ONE table (feature × method → cycle_time_sec), not a table per
-- concept (inspection_time, then inspection_sampling, then
-- inspection_equipment, ...). Real per-feature inspection times (real MTM/
-- MIL-STD-1567 studies) genuinely differ by which inspection method a
-- feature+tolerance combination escalates to (a caliper check on a hole is
-- faster than a CMM check on the same hole), so method is part of the row key,
-- not folded away.
--
-- Sampling strategy (100pct/first_article/sampling/skip) is a RUNTIME input to
-- the engine (costing/inspection-engine.ts), reusing the already-real AQL
-- sampling mechanism (sm_lookup_sampling_plan / getSamplingRate) — this table
-- only carries a per-feature SUGGESTED default, not the sampling logic itself.
--
-- Seed values are disclosed engineering estimates, not a claimed citation for
-- an exact published number — general published inspection-time ranges
-- (3-12 sec/unit visual inspection across multiple industry time-study
-- sources; Ph. Eur. 2.9.20's 5-second visual-pass standard for pharmaceutical
-- QC; thread go/no-go gauging described industry-wide as "a matter of
-- seconds") inform these values, but no single authoritative per-feature-type
-- standard exists for sheet-metal QC specifically. Same honesty convention as
-- every other sm_lookup_*/lookup table in this codebase: the engine pushes a
-- disclosed warning whenever a feature+method combo isn't seeded yet, rather
-- than silently treating an estimate as measured fact.
-- ============================================================================

CREATE TABLE IF NOT EXISTS inspection_operation_defaults (
    id                SERIAL PRIMARY KEY,
    feature           VARCHAR(30) NOT NULL,   -- 'visual_base' | 'hole' | 'bend' | 'thickness' | 'dimension' | 'thread'
    method            VARCHAR(20) NOT NULL,   -- 'visual' | 'caliper' | 'height_gauge' | 'cmm'
    cycle_time_sec    NUMERIC NOT NULL,
    sampling_default  VARCHAR(20),            -- suggested InspectionStrategy for this feature — informational, not enforced
    equipment         VARCHAR(100),           -- display-only equipment name (e.g. 'Digital Caliper') — rate still resolves via the real 'cmm' machine class
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS inspection_operation_defaults_feature_method
  ON inspection_operation_defaults(feature, method);

ALTER TABLE inspection_operation_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON inspection_operation_defaults;
CREATE POLICY "Public read" ON inspection_operation_defaults FOR SELECT USING (true);

COMMENT ON TABLE inspection_operation_defaults IS
  'Per-feature, per-method inspection cycle time (sec) — feeds costing/inspection-engine.ts''s general-purpose Inspection process line. See migration 423 for why this is one extensible table rather than one table per inspection concept.';

INSERT INTO inspection_operation_defaults (feature, method, cycle_time_sec, sampling_default, equipment) VALUES
  ('visual_base', 'visual',       5.0, 'sampling', 'Visual / Inspection Bench'),
  ('hole',        'visual',       1.2, 'sampling', 'Visual / Inspection Bench'),
  ('hole',        'caliper',      2.5, 'sampling', 'Digital Caliper'),
  ('hole',        'height_gauge', 6.0, 'sampling', 'Height Gauge'),
  ('hole',        'cmm',          10.0, '100pct',  'CMM Machine'),
  ('bend',        'visual',       2.0, 'sampling', 'Visual / Inspection Bench'),
  ('bend',        'caliper',      4.0, 'sampling', 'Digital Angle Gauge'),
  ('bend',        'height_gauge', 7.0, 'sampling', 'Height Gauge'),
  ('bend',        'cmm',          12.0, '100pct',  'CMM Machine'),
  ('thickness',   'visual',       3.0, '100pct',   'Micrometer'),
  ('thickness',   'caliper',      3.0, '100pct',   'Micrometer'),
  ('thickness',   'height_gauge', 3.0, '100pct',   'Micrometer'),
  ('thickness',   'cmm',          5.0, '100pct',   'CMM Machine'),
  ('dimension',   'visual',       5.0, '100pct',   'Digital Caliper / Tape'),
  ('dimension',   'caliper',      6.0, '100pct',   'Digital Caliper'),
  ('dimension',   'height_gauge', 9.0, '100pct',   'Height Gauge'),
  ('dimension',   'cmm',          15.0, '100pct',  'CMM Machine'),
  ('thread',      'visual',       3.0, 'sampling', 'Thread Plug Gauge'),
  ('thread',      'caliper',      4.0, 'sampling', 'Thread Plug Gauge'),
  ('thread',      'height_gauge', 6.0, 'sampling', 'Thread Plug Gauge'),
  ('thread',      'cmm',          10.0, '100pct',  'CMM Machine')
ON CONFLICT (feature, method) DO NOTHING;

-- Verification:
-- SELECT feature, method, cycle_time_sec, equipment FROM inspection_operation_defaults ORDER BY feature, method;
-- Should return 21 rows.

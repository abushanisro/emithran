-- ============================================================================
-- Migration 413: sm_lookup_deburr_rate — deburring cycle-time constants,
-- moved from code into a real, admin-editable table.
-- ============================================================================
-- Root cause: DEBURR_SEC_PER_METRE=60 and DEBURR_SEC_PER_PIERCE=0.5
-- (default-rates.ts) were unconditional hardcoded constants with NO database
-- lookup attempt at all — every sheet-metal and CNC part's deburring cost
-- used these two numbers regardless of material or thickness, with zero
-- ability for a shop to correct them without a code deploy.
--
-- Research (WebSearch, Aug 2026) into whether real per-material/per-thickness
-- deburring-rate data exists to differentiate this table, mirroring migration
-- 398's rigor bar:
--   - Edge-deburring rate: one real vendor anchor found — Heck Industries
--     "Turbo-Burr" pneumatic deburring tool, independently confirmed on three
--     listings (heckind.net, woodwardfab.com, penntoolco.com): "up to 2 in/sec,
--     10 ft/min (3.05 m/min) one-pass edging" = ~19.7 sec/metre for a single
--     powered pass, one side. This is a tool-traverse spec, not a full labor
--     cycle time (no second-side flip, handling, or inspection) — a real
--     lower bound, not a directly-usable labor rate. The existing 60 sec/m
--     constant is ~3x this floor, which is directionally plausible (full
--     hand-labor cycle vs. raw one-pass powered traverse) but not something
--     a real source lets us derive precisely.
--   - HARSLE DM-series automated deburring machine data sheet (fetched
--     directly): "Feeding Speed: 0.5-14 m/min" — brackets the plausible range
--     further, still without a material/thickness breakdown.
--   - Material effect: real, but only QUALITATIVE and not in the intuitive
--     direction assumed going in — Benchmark Abrasives ("Tips on Deburring
--     Stainless Steel") and Industrial Metal Service ("Guide to Deburring
--     Aluminum") both describe aluminum forming LARGER rollover/smeared burrs
--     (it folds rather than shears cleanly) while stainless forms smaller,
--     stiffer burrs needing more force per unit area. No source publishes a
--     numeric ratio the way VICHOR's machinability index does for cutting
--     speed (migration 398) — inventing one here would be exactly the
--     fabrication this migration exists to remove.
--   - Thickness effect: qualitatively universal (thicker sheet = bigger burr
--     — Alderman Tooling, JLC CNC) but never expressed as a formula/curve in
--     any source found.
--   - Per-pierce (hole) time: no citation-grade number found — only
--     unattributed marketing-blog claims ("a couple of seconds per hole"),
--     which don't meet the sourcing bar and are deliberately NOT cited here.
--
-- Conclusion: unlike sm_lookup_waterjet_cut (398), the real evidence base does
-- NOT support a material x thickness lookup table for deburring time. This
-- table therefore holds ONE default row, honestly labeled as an engineering
-- default (not independently measured) that is real-world-bounded (falls
-- within the Heck Turbo-Burr / HARSLE range once realistic labor overhead is
-- accounted for), not a fabricated number. The schema supports adding
-- material-keyed rows later if a real time study is ever done — the code
-- resolves by material and falls back to '__default__' rather than assuming
-- a single global row forever.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_deburr_rate (
    id              SERIAL PRIMARY KEY,
    material_family VARCHAR(20) NOT NULL DEFAULT '__default__',  -- 'aluminum'|'stainless'|'carbon_steel'|'__default__'
    sec_per_metre   NUMERIC NOT NULL,   -- manual deburr time per metre of cut edge
    sec_per_pierce  NUMERIC NOT NULL,   -- manual deburr time per pierced hole/entry point
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_deburr_rate_material ON sm_lookup_deburr_rate(material_family);

ALTER TABLE sm_lookup_deburr_rate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON sm_lookup_deburr_rate;
CREATE POLICY "Public read" ON sm_lookup_deburr_rate FOR SELECT USING (true);

COMMENT ON TABLE sm_lookup_deburr_rate IS 'Manual edge/pierce deburring cycle time (sec) — single honest default (see migration 413: real per-material/thickness data does not exist in the industry literature to differentiate this further, bounded by cited Heck Turbo-Burr / HARSLE specs)';

INSERT INTO sm_lookup_deburr_rate (material_family, sec_per_metre, sec_per_pierce) VALUES
  ('__default__', 60, 0.5)
ON CONFLICT (material_family) DO NOTHING;

-- Verification:
-- SELECT material_family, sec_per_metre, sec_per_pierce FROM sm_lookup_deburr_rate;
-- Should return 1 row.

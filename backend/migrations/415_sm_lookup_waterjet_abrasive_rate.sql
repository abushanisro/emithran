-- ============================================================================
-- Migration 415: sm_lookup_waterjet_abrasive_rate — abrasive (garnet)
-- consumption rate, moved from code into a real, admin-editable table.
-- ============================================================================
-- Root cause: WATERJET_ABRASIVE_KG_PER_MIN=0.5 (default-rates.ts) was an
-- unconditional hardcoded constant with NO database lookup attempt at all.
-- Garnet PRICE per kg was already real/DB-driven (consumable_prices,
-- migration 362) — only the CONSUMPTION RATE (kg consumed per minute of
-- active cutting) was still a bare code constant.
--
-- Research (WebSearch, Aug 2026), matching migration 398's citation rigor and
-- its already-committed reference pump tier (~50HP/60,000psi — see 398's own
-- comment on why this app's seeded machines, "KMT Streamline Waterjet
-- Large"/"Flow Mach 100 Waterjet Small", don't carry parseable pump specs
-- for anything finer):
--
--   Strongest anchor: Miroslav R. Radovanovic, "Performances of Abrasive
--   Water Jet Cutting with Hyper Pressure", International Journal of
--   Modeling and Optimization, Vol. 7 No. 5, Oct 2017, DOI:
--   10.7763/IJMO.2017.V7.597, Table III — real, physics-derived specs for
--   four 50HP pumps INCLUDING TWO KMT MODELS (KMT being the exact OEM this
--   app's own seeded machine data references):
--     KMT SL-V 50 Classic: 55,000psi, 0.014in orifice, 0.042in mixing tube
--       -> 0.530 kg/min abrasive mass flow (active-cutting-time basis, per
--       the paper's own consumption = mass_flow_rate x machining_time model)
--     KMT SL-V 50 Plus: 60,000psi, 0.013in orifice, 0.039in mixing tube
--       -> 0.470 kg/min
--   These orifice/tube sizes (0.013-0.014in / 0.039-0.042in) match the
--   industry-standard combo for this pump class almost exactly.
--
--   Corroborating sources: Dr. Olsen's Lab ("How 50hp at 60,000psi
--   Outperforms...") confirms a 50hp pump uses a 0.014in orifice at 60ksi
--   (exact tier match) with 0.8-1.0 lb/min (0.36-0.45 kg/min); Barton (garnet
--   OEM) / The Fabricator ("Best Practices for Managing Waterjet Abrasive"):
--   shop rule of thumb "~1 lb/min" (0.45 kg/min), typical range 0.75-2.4
--   lb/min (0.34-1.09 kg/min).
--
--   Material/thickness independence: CONFIRMED by three independent sources,
--   not assumed. Radovanovic's own model (abrasive mass flow = a fixed
--   ratio x water mass flow, itself fixed by orifice/pressure only) has no
--   material term. Dr. Olsen's Lab explicitly states its comparison held
--   "the same abrasive flow rate... over a wide range of materials and
--   thicknesses." Conner & Ramulu (Boeing/U. Washington, 2005 WJTA American
--   Waterjet Conference, Paper 3A-3) derive abrasive mass flow purely from
--   pump pressure + orifice/tube geometry + metering-valve setting — the
--   workpiece material never enters their equations either. Material/
--   thickness affect CUTTING SPEED (already the material+thickness axis of
--   sm_lookup_waterjet_cut, migration 398), not abrasive feed rate. This
--   table is deliberately a single machine-tier constant, not a
--   material-keyed lookup — adding a material axis here would be inventing
--   a distinction the real-world literature explicitly refutes.
--
--   Conclusion on the existing 0.5 kg/min constant: it falls inside the
--   real cited range (0.34-0.53 kg/min across all sources), closest to the
--   KMT SL-V 50 Classic anchor (0.530 kg/min) — it is upgraded here from an
--   uncited code constant to a cited, real value, unchanged in magnitude
--   because the citation confirms it was already right.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_waterjet_abrasive_rate (
    id                  SERIAL PRIMARY KEY,
    pump_tier           VARCHAR(30) NOT NULL DEFAULT '50hp_60kpsi',
    abrasive_kg_per_min  NUMERIC NOT NULL,   -- garnet consumption per minute of ACTIVE cutting time
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_waterjet_abrasive_rate_tier ON sm_lookup_waterjet_abrasive_rate(pump_tier);

ALTER TABLE sm_lookup_waterjet_abrasive_rate ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON sm_lookup_waterjet_abrasive_rate;
CREATE POLICY "Public read" ON sm_lookup_waterjet_abrasive_rate FOR SELECT USING (true);

COMMENT ON TABLE sm_lookup_waterjet_abrasive_rate IS 'Garnet abrasive consumption rate (kg/min of active cutting) by pump tier — see migration 415 for the Radovanovic (2017) IJMO Table III citation at this app''s committed ~50HP/60,000psi reference tier';

INSERT INTO sm_lookup_waterjet_abrasive_rate (pump_tier, abrasive_kg_per_min) VALUES
  ('50hp_60kpsi', 0.5)
ON CONFLICT (pump_tier) DO NOTHING;

-- Verification:
-- SELECT pump_tier, abrasive_kg_per_min FROM sm_lookup_waterjet_abrasive_rate;
-- Should return 1 row.

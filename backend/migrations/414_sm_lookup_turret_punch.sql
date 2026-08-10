-- ============================================================================
-- Migration 414: sm_lookup_turret_punch — turret punch press cycle-time
-- constants, moved from code into a real, admin-editable table.
-- ============================================================================
-- Root cause: TURRET_HITS_PER_MIN, TURRET_NIBBLE_MM_PER_MIN, and
-- TURRET_TOOL_CHANGE_SEC (default-rates.ts) were unconditional hardcoded
-- constants with NO database lookup attempt at all.
--
-- Research (WebSearch, Aug 2026), matching migration 398's citation rigor:
--
--   Hits/min (thickness axis): real, independently-corroborated bracket
--   found — Wikipedia's turret-punch article states real-world "working
--   speeds range from 80 to about 300 hits per minute"; ~200 hpm at a
--   standard 1"/25mm pitch is independently confirmed across FOUR real
--   20-33 ton job-shop-class machines from TWO manufacturers (Amada Pega
--   357, Amada EMK-3612 M2 Y-axis, Murata Centrum 2000, Murata Magnum 1250 —
--   Revelation Machinery / Zebra Worldwide / The Equipment Hub listings).
--   However: every real spec sheet rates hit rate at a stated PITCH/STROKE,
--   never directly against sheet thickness_mm the way this table is keyed —
--   no source ties hpm to thickness_mm at multiple points the way waterjet's
--   two-anchor curve fit (398) was possible. The existing thickness-keyed
--   curve (250/200/150/100/80/60 hpm at 1-6mm) is kept AS-IS: it is bracketed
--   by the real 80-300 hpm range at every point, and changing specific
--   per-mm values without a real per-thickness citation would be inventing
--   false precision, not correcting it. Labeled as an engineering default
--   informed by (not independently derived from) the cited real bracket.
--
--   Nibble mm/min: real anchors exist but are pitch-dependent and one source
--   (Amada EMK-3612 M2 nibbling vs. marking hit rate) could not be
--   disambiguated with confidence from the primary spec sheet (404/blocked).
--   Kept AS-IS (1200/800/600/400 mm/min at 1-4mm) for the same reason as
--   hits/min: real, but not cleanly derivable to a corrected curve.
--
--   Tool/turret index time: this ONE constant has a strong, unambiguous,
--   real-sourced case for correction, not just relocation. Every citation
--   found clusters at 0.3-3.5 sec for a modern CNC turret punch station
--   change — Trumpf TruPunch 2020 spec (single-tool change: 3.5 sec;
--   multi-tool change: 0.9 sec, turret rotation 3 rev/sec), Trumpf TruPunch
--   3000 spec (multi-tool change: 0.3 sec, turret rotation 330 rpm), and
--   MachineMFG's manufacturing guide ("tool change time of approximately
--   1.5 seconds for adjacent tool positions... rotation time ~2.5 seconds...
--   typical practice uniformed to 2.0 seconds per index"). The prior
--   TURRET_TOOL_CHANGE_SEC=30 constant is 10-100x every real citation found —
--   this migration corrects it to 2.0 sec (MachineMFG's own cited "typical
--   practice" figure, sitting mid-range of the 0.3-3.5 sec real bracket).
--
--   Material axis: confirmed NOT warranted for hits/min or nibble speed.
--   The real, quantified mechanism (Ironworker/punch tonnage charts,
--   fabtechsolutions/amadamca: Tonnage = Perimeter x Thickness x Shear
--   Strength x Coefficient / 1000, with published shear-strength-by-material
--   values) shows material determines REQUIRED TONNAGE (i.e. machine
--   capability/feasibility — already handled by this app's
--   machine-capability.ts), not the ram-cycle/index speed of a machine
--   already sized for the job. No source publishes a "hits/min x material
--   multiplier" table analogous to laser/waterjet's cutting-speed
--   machinability index. This table is deliberately thickness-only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sm_lookup_turret_punch (
    id                  SERIAL PRIMARY KEY,
    thickness_mm        NUMERIC NOT NULL,
    hits_per_min        NUMERIC NOT NULL,
    nibble_mm_per_min   NUMERIC,
    -- Machine-index-time penalty per unique punch-die diameter used on a
    -- part. NOT thickness-dependent (a real, documented machine spec — see
    -- above) — same value repeated on every row rather than a separate
    -- single-row table, so one query resolves the whole turret-punch
    -- parameter set for a given thickness.
    tool_change_sec     NUMERIC NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sm_turret_punch_thickness ON sm_lookup_turret_punch(thickness_mm);

ALTER TABLE sm_lookup_turret_punch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON sm_lookup_turret_punch;
CREATE POLICY "Public read" ON sm_lookup_turret_punch FOR SELECT USING (true);

COMMENT ON TABLE sm_lookup_turret_punch IS 'Turret punch press hits/min + nibble speed (mm/min) by thickness, and tool-change index time (sec) — see migration 414 for real-bracket citations and the tool_change_sec correction from a fabricated 30s to a cited 2.0s';

INSERT INTO sm_lookup_turret_punch (thickness_mm, hits_per_min, nibble_mm_per_min, tool_change_sec) VALUES
  (1, 250, 1200, 2.0),
  (2, 200, 800,  2.0),
  (3, 150, 600,  2.0),
  (4, 100, 400,  2.0),
  (5, 80,  400,  2.0),
  (6, 60,  400,  2.0)
ON CONFLICT (thickness_mm) DO NOTHING;

-- Verification:
-- SELECT thickness_mm, hits_per_min, nibble_mm_per_min, tool_change_sec
--   FROM sm_lookup_turret_punch ORDER BY thickness_mm;
-- Should return 6 rows.

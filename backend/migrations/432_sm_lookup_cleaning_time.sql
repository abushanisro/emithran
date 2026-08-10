-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 432: sm_lookup_cleaning_time — real, sourced ultrasonic-cleaning
-- bath-time data, classified EXACT_MATCH (2026-08-08)
--
-- Closes the "Cleaning" side of task #114. migration 425 gave the
-- 'cleaning' machine_class a real place in the routing tree
-- (process_calculator_mappings: Post Processing / Cleaning / Ultrasonic
-- Cleaning) but left calculator_id NULL — no calculator, no lookup table, no
-- cost path existed for it at all until now. There is no CAD-detectable
-- signal today for "does this part need ultrasonic cleaning" (unlike
-- Deburring's cut-length or PEM's hole-diameter match), so this migration
-- deliberately stops at making the calculator itself real and resolvable —
-- the same generic "Edit Process Cost" calculator path every other
-- registered calculator already gets — rather than inventing a new
-- automatic-trigger heuristic with no real signal to base it on.
--
-- Bath time by soiling/complexity tier, sourced from published industrial
-- ultrasonic-cleaning vendor guidance (midpoint of each cited range —
-- disclosed as an engineering-standard assumption, not a part-specific
-- measurement, same convention as sm_lookup_deburr_rate):
--   simple  (light soiling)  : 2-3 min   -> 180 sec  (Crest Ultrasonics;
--             Kaijo: "light soil on dense metals cleans in 2-3 minutes")
--   inter   (medium soiling) : 6-10 min  -> 480 sec  (Baron Blakeslee;
--             Sonirity: "medium cycles (5-10 min) for moderately soiled items")
--   complex (heavy soiling)  : 10-20 min -> 900 sec  (Crest Ultrasonics;
--             Baron Blakeslee: "heavy soiling... 10 to 20 minutes or more")
-- Sources: crest-ultrasonics.com/how-long-does-ultrasonic-cleaning-take,
--   baronblakeslee.net/how-long-should-you-run-an-ultrasonic-cleaner...,
--   sonirity.com/blogs/ultrasonic-cleaner/how-long-to-run-ultrasonic-cleaner,
--   kaijo-shibuya.com/how-long-will-ultrasonic-cleaning-take-to-clean-my-parts
--
-- Classified EXACT_MATCH (not INTERPOLATE): these are three discrete,
-- named soiling tiers a part is assigned to, not a continuous physical
-- curve — same reasoning as sm_lookup_inspection_time's own
-- simple/inter/complex tiers (migration 412), not a thickness/speed curve
-- like sm_lookup_laser_cut.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sm_lookup_cleaning_time (
  id              SERIAL PRIMARY KEY,
  complexity      TEXT NOT NULL UNIQUE CHECK (complexity IN ('simple', 'inter', 'complex')),
  bath_time_sec   NUMERIC(8,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sm_lookup_cleaning_time ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_lookup_cleaning_time_read ON sm_lookup_cleaning_time;
CREATE POLICY sm_lookup_cleaning_time_read ON sm_lookup_cleaning_time FOR SELECT USING (true);

INSERT INTO sm_lookup_cleaning_time (complexity, bath_time_sec) VALUES
  ('simple', 180),
  ('inter', 480),
  ('complex', 900)
ON CONFLICT (complexity) DO NOTHING;

INSERT INTO lookup_table_policy (table_name, policy, reason) VALUES
  ('sm_lookup_cleaning_time', 'EXACT_MATCH',
    'Three discrete, named soiling/complexity tiers (simple/inter/complex) a part is assigned to for its ultrasonic cleaning bath time — same reasoning as sm_lookup_inspection_time''s tiers (migration 412), not a continuous physical curve like a feed-rate table.')
ON CONFLICT (table_name) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT * FROM sm_lookup_cleaning_time ORDER BY bath_time_sec;
-- SELECT * FROM lookup_table_policy WHERE table_name = 'sm_lookup_cleaning_time';

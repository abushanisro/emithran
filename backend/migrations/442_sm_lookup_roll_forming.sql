-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 442: sm_lookup_roll_forming — move Roll Forming's Line Speed and
-- Setup Time out of a hardcoded calculator-field default, into a real,
-- editable DB table (2026-08-08)
--
-- Root cause: calculators/056_sheet_metal_roll_forming_calculator.sql (this
-- session, already applied) baked its real, sourced Line Speed (30.5 m/min)
-- and Setup Time (20 min) directly into calculator_fields.default_value —
-- a static literal sitting in a migration file, not a real DB row an admin
-- can review, correct, or extend later via the Process page's "Lookup
-- Tables" dialog. Every OTHER disclosed-default field in this architecture
-- (sm_lookup_cleaning_time, sm_lookup_deburr_rate, ...) lives in a real
-- table for exactly this reason, even when — like this one — it currently
-- holds only a single representative row. This migration corrects Roll
-- Forming to match that convention instead of being the one exception.
--
-- Sources (same research this session, unchanged):
--   Line Speed: "smaller operations net only ~100-110 fpm even on 150 fpm-
--     rated lines" (Rollforming Magazine, "Do You Need a High-Speed Roll
--     Former, or Can You Get More with What You've Got?",
--     rollformingmagazine.com) — ≈30.5 m/min.
--   Setup Time: "~15 min/pass for conventional small mills (1.5-2in
--     spindle), ~20 min/pass for 2.5-3in mills" (Formtek Group blog, "Roll
--     Forming Line Operation and Setup", blog.formtekgroup.com) — 20 min
--     midpoint used.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sm_lookup_roll_forming (
  id                SERIAL PRIMARY KEY,
  line_speed_m_min  NUMERIC(8,2) NOT NULL,
  setup_time_min    NUMERIC(8,2) NOT NULL,
  source            TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sm_lookup_roll_forming ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_lookup_roll_forming_read ON sm_lookup_roll_forming;
CREATE POLICY sm_lookup_roll_forming_read ON sm_lookup_roll_forming FOR SELECT USING (true);

INSERT INTO sm_lookup_roll_forming (line_speed_m_min, setup_time_min, source)
SELECT 30.5, 20,
  'Rollforming Magazine (achievable shop-floor line speed, ~100-110 fpm) + Formtek Group blog (conventional roll-tooling changeover time)'
WHERE NOT EXISTS (SELECT 1 FROM sm_lookup_roll_forming);

INSERT INTO lookup_table_policy (table_name, policy, reason) VALUES
  ('sm_lookup_roll_forming', 'EXACT_MATCH',
    'A single disclosed representative shop-floor rate (no real vendor/handbook source publishes a per-material/thickness speed table for roll forming — see this table''s own row comment) — treated as one discrete row, not a curve, same convention as sm_lookup_deburr_rate.')
ON CONFLICT (table_name) DO NOTHING;

-- Clear the hardcoded defaults migration 056 set — these fields are now
-- lookup-fed (a real caller queries sm_lookup_roll_forming and feeds the
-- result into seedScope, same convention as every other lookup-fed field;
-- a NULL default here means a standalone/interactive use of this calculator
-- with no caller-supplied value correctly shows nothing rather than a
-- silently-baked-in number).
UPDATE calculator_fields
SET default_value = NULL
WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Roll Forming')
  AND field_name IN ('Line Speed', 'Setup Time');

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT * FROM sm_lookup_roll_forming;
-- SELECT field_name, default_value FROM calculator_fields
--   WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Roll Forming')
--   ORDER BY display_order;
-- Expect 'Line Speed'/'Setup Time' default_value = NULL.

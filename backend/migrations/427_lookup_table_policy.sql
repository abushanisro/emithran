-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 427: lookup_table_policy — explicit resolution policy per lookup table
-- (2026-08-07)
--
-- Part of the "Manufacturing Physics Calculator" architecture (see
-- .claude/plans — Workstream 1e). Root cause this closes: two separate,
-- inconsistent implementations of the SAME sm_lookup_manual_stroke lookup
-- exist today — sheet-metal-lookup.service.ts's getManualStrokeTime does a
-- TRUE nearest-match on thickness (considers rows above AND below the
-- request); calculators.service.ts's resolveSheetMetalLookup('manual_stroke')
-- does a round-DOWN-only match (.lte('thickness_mm', thickness)) that returns
-- nothing when the request falls below every seeded thickness — confirmed
-- live: the Press Brake interactive calculator crashed on exactly this case
-- (1.5mm below the table's lowest seeded row).
--
-- Neither implementation's guess is actually correct for this table: stroke/
-- setup/tool-change times are discrete manufacturing operations (a real
-- machine either has a measured stroke time for this exact thickness/tonnage/
-- complexity combination, or it doesn't) — not a continuous physical curve
-- that legitimately supports interpolation. Guessing via nearest-match or
-- round-down here is the same category of fabricated-value problem as a
-- hardcoded TS constant, just hidden inside a DB query.
--
-- This table lets every sm_lookup_* table declare, once, which resolution
-- strategy is actually correct for its data:
--   EXACT_MATCH  — discrete operations. No exact row -> a reported gap, never
--                  a neighbor/round-down guess. (sm_lookup_manual_stroke,
--                  sm_lookup_tool_setup, sm_lookup_pem_hardware, ...)
--   INTERPOLATE  — genuinely continuous engineering curves (feed rate vs.
--                  thickness, cutting speed vs. power) where a real value
--                  between two seeded, on-file points is physically
--                  meaningful. Must be disclosed as interpolated in the
--                  trace, never presented as an exact hit.
--   RANGE        — the input is naturally bucketed (e.g. a weight/thickness
--                  band); matched by which real seeded band it falls into.
--   FORMULA      — no table dependency; a pure physics formula, not a lookup
--                  at all (kept here for completeness/documentation only —
--                  a FORMULA-classified "table" is typically absent from
--                  this registry entirely).
--
-- Default: any table not listed here is treated as EXACT_MATCH by calling
-- code (the conservative default per the architecture's own rule) — rows are
-- only added below when a table is deliberately, explicitly reclassified,
-- with a real reason.
-- ════════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lookup_table_policy (
  table_name  TEXT PRIMARY KEY,
  policy      TEXT NOT NULL CHECK (policy IN ('EXACT_MATCH', 'INTERPOLATE', 'RANGE', 'FORMULA')),
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Public read (this is app configuration, not tenant data) — mirrors the RLS
-- convention already used for other shared sm_lookup_*/benchmark tables.
ALTER TABLE lookup_table_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lookup_table_policy_read ON lookup_table_policy;
CREATE POLICY lookup_table_policy_read ON lookup_table_policy FOR SELECT USING (true);

INSERT INTO lookup_table_policy (table_name, policy, reason) VALUES
  ('sm_lookup_manual_stroke', 'EXACT_MATCH',
    'Discrete stroke/setup time per (thickness, tonnage, complexity) — a real machine either has a measured time for this exact combination or it does not. The root cause of the live crash this migration accompanies: both existing query implementations were silently guessing (nearest-match / round-down) instead of reporting the real gap.'),
  ('sm_lookup_tool_setup', 'EXACT_MATCH',
    'Discrete tool/bend-length setup time bands — same reasoning as manual_stroke. calculators.service.ts already had to patch a round-down underflow bug here (small parts below the smallest seeded key_value); classifying EXACT_MATCH means that case becomes a reported gap, not a clamped guess.'),
  ('sm_lookup_pem_hardware', 'EXACT_MATCH',
    'PEM hardware insertion is matched by real, discrete part-number/hole-size combinations from a manufacturer catalog — there is no meaningful "interpolated" PEM fastener.'),
  ('sm_lookup_laser_cut', 'INTERPOLATE',
    'Cutting speed vs. thickness/power is a genuinely continuous physical relationship (laser cutting physics) — a real speed value between two seeded, on-file thickness/power points is physically meaningful, unlike a discrete operation time. Interpolation here has always been the intended design (see this table''s own migration 398), not an accidental guess — this migration makes that design explicit rather than implicit.'),
  ('sm_lookup_waterjet_cut', 'INTERPOLATE',
    'Same reasoning as sm_lookup_laser_cut — cutting speed vs. thickness is a continuous curve for waterjet too.'),
  ('sm_lookup_stroke_rate', 'INTERPOLATE',
    'Automatic-machine stroke rate vs. tonnage is a continuous curve (press mechanics), not a discrete count — same category as laser/waterjet feed curves.')
ON CONFLICT (table_name) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT table_name, policy, reason FROM lookup_table_policy ORDER BY table_name;

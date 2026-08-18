-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 473: MHR/LHR rate-plausibility warning thresholds → costing_settings
--
-- benchmarkRateWarning() (default-rates.ts) has flagged an implausible MACHINE
-- rate against its location benchmark since migration 327 -- but its 0.5/3.0
-- fractions were hardcoded TS constants, not configurable business policy. The
-- new equivalent LABOUR guard (lhrRateWarning(), added this migration's
-- matching code change) needs the identical thresholds. Rather than duplicate
-- them as a second set of hardcoded constants, both now read these two rows
-- from the SAME `costing_settings` table migration 364 already established for
-- exactly this purpose ("business-level costing parameters... configured per
-- environment without code changes"). Both call sites keep the current 0.5/3.0
-- as an in-code fallback (with a disclosed warning) if this table is ever
-- empty -- identical convention to sga_pct/profit_pct's own fallback.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO costing_settings (key, value, description) VALUES
  ('rate_warn_low_fraction',  0.5, 'MHR/LHR plausibility guard: a resolved rate below this fraction of its location benchmark is flagged as suspicious (e.g. 0.5 = 50%)'),
  ('rate_warn_high_fraction', 3.0, 'MHR/LHR plausibility guard: a resolved rate above this multiple of its location benchmark is flagged as suspicious (e.g. 3.0 = 300%)')
ON CONFLICT (key) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT key, value FROM costing_settings WHERE key IN ('rate_warn_low_fraction', 'rate_warn_high_fraction');

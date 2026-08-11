-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 464: Real, distinct labour tier for 5-axis / mill-turn CNC (2026-08-11)
--
-- BUG (same class as migration 411's Deburr/Turret fix): migration 424 mapped ALL
-- six CNC machine classes (cnc_3ax_vmc, cnc_4ax_vmc, cnc_5ax_mc, cnc_lathe,
-- cnc_lathe_live, cnc_mill_turn) to one shared lhr_process_group = 'CNC Machining'.
-- That's correct for 3/4-axis mills and standard lathes, but the source "Digital
-- Factory 2026" spreadsheet (memory/database/Combined_All_Countries_Database.json,
-- same source migration 361 was built from) shows 5-axis machining centres and
-- mill-turn machines billed at a genuinely higher, distinct skill tier — verified
-- by grouping every 'Machining' row by machine model:
--
--   Standard tier (Mazak/Okuma/Daewoo/Haas SL lathes, Makino V-/a-series 3-4 axis
--   mills) — matches the existing 'CNC Machining' rate exactly, every location:
--     USA 46.67, Germany 45.14, China 13.01, Mexico 13.00, India 2.75
--
--   5-axis / mill-turn tier (Makino D-series HMC, Index ratioline, Mazak/Majak
--   Integrex mill-turn) — consistently ~9-10% above standard, every location that
--   has both tiers on file:
--     USA 51.15 (vs 46.67), Germany 49.48 (vs 45.14), China 14.26 (vs 13.01),
--     Mexico 15.00 (vs 13.00)
--   India: source shows 2.75 for this tier too — IDENTICAL to its own standard
--   tier (already 2.75), so no distinct India rate exists to seed; seeded anyway
--   below at the same 2.75 so the group-split doesn't regress it to "no data".
--
-- GAP, DISCLOSED NOT GUESSED (same pattern as migration 411): UK / France /
-- W. Europe / E. Europe / Vietnam are not in the Digital Factory 2026 source at
-- all (it only covers USA/Mexico/Germany/China/India — their lhr_benchmark_rates
-- rows come from the older industry-benchmark seed, migration 345/361 part 1).
-- No real 5-axis/mill-turn premium exists for them to seed, so after this
-- migration cnc_5ax_mc/cnc_mill_turn LHR at those 5 locations shows "no data"
-- (blank) instead of silently reusing the standard CNC Machining number — an
-- honest gap, not a fabricated premium.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Split the mapping: 5-axis / mill-turn classes get their own lhr group ────
UPDATE process_calculator_mappings SET lhr_process_group = 'CNC 5-Axis / Mill-Turn'
  WHERE machine_class IN ('cnc_5ax_mc', 'cnc_mill_turn');

-- cnc_3ax_vmc / cnc_4ax_vmc / cnc_lathe / cnc_lathe_live keep lhr_process_group =
-- 'CNC Machining' (set by migration 424) — unchanged, already the correct tier.

-- ── 2. Seed the real, sourced rate for the new group ────────────────────────────
INSERT INTO lhr_benchmark_rates
  (labour_code, labour_type, description, lhr, location, process_group, currency, currency_symbol, lhr_usd_effective)
VALUES
('BM-US-5X', '5-Axis / Mill-Turn Machinist', '2026 all-in LHR — USA / CNC 5-Axis / Mill-Turn (Combined_All_Countries_Database.json)',      51.15, 'USA',     'CNC 5-Axis / Mill-Turn', 'USD', '$',   51.15),
('BM-DE-5X', '5-Axis / Mill-Turn Machinist', '2026 all-in LHR — Germany / CNC 5-Axis / Mill-Turn (Combined_All_Countries_Database.json)',  49.48, 'Germany', 'CNC 5-Axis / Mill-Turn', 'EUR', '€',   49.48),
('BM-CN-5X', '5-Axis / Mill-Turn Machinist', '2026 all-in LHR — China / CNC 5-Axis / Mill-Turn (Combined_All_Countries_Database.json)',    14.26, 'China',   'CNC 5-Axis / Mill-Turn', 'CNY', '¥',   14.26),
('BM-MX-5X', '5-Axis / Mill-Turn Machinist', '2026 all-in LHR — Mexico / CNC 5-Axis / Mill-Turn (Combined_All_Countries_Database.json)',   15.00, 'Mexico',  'CNC 5-Axis / Mill-Turn', 'MXN', 'MX$', 15.00),
('BM-IN-5X', '5-Axis / Mill-Turn Machinist', '2026 all-in LHR — India / CNC 5-Axis / Mill-Turn (source shows same rate as standard tier)', 2.75,  'India',   'CNC 5-Axis / Mill-Turn', 'INR', '₹',   2.75)
ON CONFLICT (location, process_group) DO UPDATE SET
  labour_code       = EXCLUDED.labour_code,
  labour_type       = EXCLUDED.labour_type,
  description       = EXCLUDED.description,
  lhr               = EXCLUDED.lhr,
  currency          = EXCLUDED.currency,
  currency_symbol   = EXCLUDED.currency_symbol,
  lhr_usd_effective = EXCLUDED.lhr_usd_effective,
  updated_at        = now();

-- ── Verification ───────────────────────────────────────────────────────────────
-- SELECT machine_class, lhr_process_group FROM process_calculator_mappings
--   WHERE machine_class IN ('cnc_3ax_vmc','cnc_4ax_vmc','cnc_5ax_mc','cnc_lathe','cnc_lathe_live','cnc_mill_turn')
--   ORDER BY machine_class;
-- SELECT location, process_group, lhr_usd_effective FROM lhr_benchmark_rates
--   WHERE process_group IN ('CNC Machining', 'CNC 5-Axis / Mill-Turn') ORDER BY process_group, location;
-- Expect 'CNC 5-Axis / Mill-Turn' > 'CNC Machining' for USA/Germany/China/Mexico,
-- equal for India, absent for UK/France/W. Europe/E. Europe/Vietnam.

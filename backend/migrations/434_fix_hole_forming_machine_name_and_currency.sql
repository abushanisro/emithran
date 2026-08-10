-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 434: Fix hole_forming (Hole Flanging / Burring) machine names and
-- missing currency conversion in mhr_records (2026-08-08)
--
-- Root cause, found while reviewing the "HR Rates" page's hole_forming rows:
--
-- 1. WEIRD MACHINE NAMES: migration 409 baked its own researched pricing-basis
--    citation directly into mhr_records.machine_name — e.g. "Hole Flanging /
--    Burring Station (10-ton press, new — Fresan FP10P ref.)" — identically for
--    FOUR different countries (Germany/France/W. Europe/E. Europe all cite the
--    same "Fresan FP10P ref." with different rates), and differently-shaped
--    parentheticals for USA/China/India/Mexico. No other machine class in this
--    app puts a research citation inside the user-facing display name — every
--    sibling class (Press Brake, CNC Turret Punch, Waterjet Cutter, ...) keeps
--    the citation in mhr_benchmark_rates.machine_ref and leaves machine_name
--    clean. 409's OWN mhr_benchmark_rates rows for this exact class already use
--    the clean name 'Hole Flanging / Burring Station' with no parenthetical —
--    this migration just makes mhr_records match that existing, correct
--    convention instead of introducing a second, inconsistent one.
--
-- 2. WRONG "Total OH" NUMBERS: migration 409 correctly stored each location's
--    machine rate in LOCAL currency into mhr_records (manual_mhr_value /
--    total_machine_hour_rate / fully_burdened_local_per_hr) — e.g. India's real
--    ₹23.52/hr — but never set currency / currency_symbol / mhr_usd_per_hour on
--    the row (a raw SQL INSERT bypasses mhr.service.ts's
--    computeUsdAndBurdenedRates(), the ONLY code path that populates those
--    three columns). The "HR Rates" page's Total OH column falls back to the
--    LOCAL-currency manual_mhr_value whenever mhr_usd_per_hour is NULL
--    (app/(dashboard)/hr-rates/page.tsx) — so India displayed "$23.52" (its
--    real RUPEE rate, unconverted) instead of the real ~$0.28/hr, Mexico
--    displayed "$4.99" (its real PESO rate) instead of ~$0.29/hr, and so on.
--    This is the exact same bug class already fixed for other rows by
--    backend/src/database/migrations/327_fix_combined_format_currency_bug.sql —
--    hole_forming's rows fell through that fix because they use the
--    manual_mhr_value/total_machine_hour_rate fields, not the
--    direct_overhead_rate/indirect_overhead_rate fields 327's detection query
--    matches on.
--    The correct USD figure for each location was ALREADY computed correctly
--    by migration 409 itself, just into the SIBLING mhr_benchmark_rates table
--    (mhr_usd column) instead of mhr_records — this migration copies it across
--    via a join on location, rather than re-deriving or re-typing any number.
--
-- 3. China's row currently shows machine_class = '-' (blank) on the HR Rates
--    page even though every other location shows 'hole_forming' — its
--    mhr_usd_per_hour is ALSO already correctly populated (0.13), unlike the
--    other 7 rows, meaning this ONE row was independently opened/saved through
--    the app's own MHR edit UI at some point (the only code path that
--    populates mhr_usd_per_hour) and machine_class was lost in that save.
--    Restored here from the same real source (this is still a hole_forming /
--    Hole Extrusion (Burring) machine — nothing else it could be).
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Clean machine_name — drop the baked-in citation parenthetical, matching
--      mhr_benchmark_rates' own clean name for this exact class ─────────────────
UPDATE mhr_records
SET machine_name = 'Hole Flanging / Burring Station'
WHERE commodity_code = 'SM-BURR-FORM'
  AND machine_name LIKE 'Hole Flanging / Burring Station (%';

-- ── 2. Currency + currency_symbol per location (getCurrencyForLocation's own
--      mapping, mhr-calculation.constants.ts) ──────────────────────────────────
UPDATE mhr_records SET currency = 'USD', currency_symbol = '$'   WHERE commodity_code = 'SM-BURR-FORM' AND location = 'USA';
UPDATE mhr_records SET currency = 'CNY', currency_symbol = '¥'   WHERE commodity_code = 'SM-BURR-FORM' AND location = 'China';
UPDATE mhr_records SET currency = 'INR', currency_symbol = '₹'   WHERE commodity_code = 'SM-BURR-FORM' AND location = 'India';
UPDATE mhr_records SET currency = 'EUR', currency_symbol = '€'   WHERE commodity_code = 'SM-BURR-FORM' AND location IN ('Germany', 'France', 'W. Europe', 'E. Europe');
UPDATE mhr_records SET currency = 'MXN', currency_symbol = 'MX$' WHERE commodity_code = 'SM-BURR-FORM' AND location = 'Mexico';

-- ── 3. mhr_usd_per_hour — copy the already-correct converted figure from the
--      sibling mhr_benchmark_rates row for the SAME location, instead of
--      re-deriving or re-typing any number ──────────────────────────────────────
UPDATE mhr_records m
SET mhr_usd_per_hour = b.mhr_usd
FROM mhr_benchmark_rates b
WHERE m.commodity_code = 'SM-BURR-FORM'
  AND b.machine_name = 'Hole Flanging / Burring Station'
  AND b.location = m.location
  AND (m.mhr_usd_per_hour IS NULL OR m.mhr_usd_per_hour <> b.mhr_usd);

-- ── 4. Restore China's machine_class, lost by an out-of-band UI save ───────────
UPDATE mhr_records
SET machine_class = 'hole_forming'
WHERE commodity_code = 'SM-BURR-FORM'
  AND location = 'China'
  AND (machine_class IS NULL OR machine_class = '');

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, machine_name, machine_class, currency, manual_mhr_value, mhr_usd_per_hour
--   FROM mhr_records WHERE commodity_code = 'SM-BURR-FORM' ORDER BY location;
-- Expect: machine_name identical across all 8 rows ('Hole Flanging / Burring
-- Station'), machine_class = 'hole_forming' for all 8, mhr_usd_per_hour
-- matching mhr_benchmark_rates' figures (USA 0.25, China 0.13, India 0.28,
-- Germany 1.26, France 1.18, W. Europe 1.23, E. Europe 1.10, Mexico 0.29) —
-- NOT the raw local-currency manual_mhr_value shown before this fix.

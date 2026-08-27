-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 366: Fix press brake benchmark rates (2026-07-22)
--
-- Problem: mhr_benchmark_rates kN-tonnage rows (800kN/1500kN/2500kN) stored
-- eMithran machine-amortization-only rates ($5–26/hr). These are CAPITAL COST
-- only — not full-burden overhead rates. When mixed into the benchmark pool
-- with the full-burden "Press Brake" row ($74/hr USA), the median collapsed
-- to ~$24/hr, producing a false guard band that allowed $9/hr press brake
-- rates to pass unchallenged through applyBenchmarkOverrideIfNeeded().
--
-- Fix: UPDATE all kN rows to full-burden Total Overhead Rates (same convention
-- as mhr_records and the non-kN benchmark rows). USA $60/hr matches the
-- existing "Press Brake 80T (2500mm)" mhr_records row exactly.
--
-- Idempotent: plain UPDATEs on rows that already exist — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── Press Brake 800kN (80T class) ────────────────────────────────────────────
UPDATE mhr_benchmark_rates
SET mhr_usd = 60.00,
    machine_ref = 'Amada HFE 80T — full burden incl maintenance, power, facility'
WHERE machine_name = 'Press Brake 800kN' AND location = 'USA';

UPDATE mhr_benchmark_rates
SET mhr_usd = 9.50,
    machine_ref = 'Delem 80T — full burden INR equiv ~₹793/hr'
WHERE machine_name = 'Press Brake 800kN' AND location = 'India';

UPDATE mhr_benchmark_rates
SET mhr_usd = 68.00,
    machine_ref = 'Trumpf TruBend 5085 — full burden EUR equiv ~€62/hr'
WHERE machine_name = 'Press Brake 800kN' AND location = 'Germany';

UPDATE mhr_benchmark_rates
SET mhr_usd = 62.00,
    machine_ref = 'Amada HFE 80T — full burden EUR equiv ~€57/hr'
WHERE machine_name = 'Press Brake 800kN' AND location = 'France';

UPDATE mhr_benchmark_rates
SET mhr_usd = 64.00,
    machine_ref = 'Amada HFE 80T — full burden EUR equiv ~€59/hr'
WHERE machine_name = 'Press Brake 800kN' AND location = 'W. Europe';

UPDATE mhr_benchmark_rates
SET mhr_usd = 28.00,
    machine_ref = 'Durma AD-S 80T — full burden EUR equiv ~€26/hr'
WHERE machine_name = 'Press Brake 800kN' AND location = 'E. Europe';

UPDATE mhr_benchmark_rates
SET mhr_usd = 58.00,
    machine_ref = 'Amada HFE 80T — full burden GBP equiv ~£46/hr'
WHERE machine_name = 'Press Brake 800kN' AND location = 'UK';

UPDATE mhr_benchmark_rates
SET mhr_usd = 22.00,
    machine_ref = 'Durma AD-S 80T China — full burden USD'
WHERE machine_name = 'Press Brake 800kN' AND location = 'China';

UPDATE mhr_benchmark_rates
SET mhr_usd = 16.00,
    machine_ref = 'Amada HFE 80T Vietnam — full burden USD'
WHERE machine_name = 'Press Brake 800kN' AND location = 'Vietnam';

UPDATE mhr_benchmark_rates
SET mhr_usd = 28.00,
    machine_ref = 'Amada HFE 80T Mexico — full burden USD'
WHERE machine_name = 'Press Brake 800kN' AND location = 'Mexico';

-- ── Press Brake 1500kN (160T class) ──────────────────────────────────────────
UPDATE mhr_benchmark_rates
SET mhr_usd = 70.00,
    machine_ref = 'Trumpf TruBend 5130 — full burden incl maintenance, power, facility'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'USA';

UPDATE mhr_benchmark_rates
SET mhr_usd = 11.50,
    machine_ref = 'Delem 160T — full burden INR equiv ~₹960/hr'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'India';

UPDATE mhr_benchmark_rates
SET mhr_usd = 80.00,
    machine_ref = 'Trumpf TruBend 5130 — full burden EUR equiv ~€73/hr'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'Germany';

UPDATE mhr_benchmark_rates
SET mhr_usd = 73.00,
    machine_ref = 'Amada HFE 160T — full burden EUR equiv ~€67/hr'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'France';

UPDATE mhr_benchmark_rates
SET mhr_usd = 75.00,
    machine_ref = 'Amada HFE 160T — full burden EUR equiv ~€69/hr'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'W. Europe';

UPDATE mhr_benchmark_rates
SET mhr_usd = 33.00,
    machine_ref = 'Durma AD-S 160T — full burden EUR equiv ~€30/hr'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'E. Europe';

UPDATE mhr_benchmark_rates
SET mhr_usd = 68.00,
    machine_ref = 'Amada HFE 160T — full burden GBP equiv ~£54/hr'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'UK';

UPDATE mhr_benchmark_rates
SET mhr_usd = 26.00,
    machine_ref = 'Durma AD-S 160T China — full burden USD'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'China';

UPDATE mhr_benchmark_rates
SET mhr_usd = 19.00,
    machine_ref = 'Amada HFE 160T Vietnam — full burden USD'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'Vietnam';

UPDATE mhr_benchmark_rates
SET mhr_usd = 33.00,
    machine_ref = 'Amada HFE 160T Mexico — full burden USD'
WHERE machine_name = 'Press Brake 1500kN' AND location = 'Mexico';

-- ── Press Brake 2500kN (250T class) ──────────────────────────────────────────
UPDATE mhr_benchmark_rates
SET mhr_usd = 82.00,
    machine_ref = 'Trumpf TruBend 5260 — full burden incl maintenance, power, facility'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'USA';

UPDATE mhr_benchmark_rates
SET mhr_usd = 13.50,
    machine_ref = 'Delem 250T — full burden INR equiv ~₹1127/hr'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'India';

UPDATE mhr_benchmark_rates
SET mhr_usd = 94.00,
    machine_ref = 'Trumpf TruBend 5260 — full burden EUR equiv ~€86/hr'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'Germany';

UPDATE mhr_benchmark_rates
SET mhr_usd = 86.00,
    machine_ref = 'Amada HFE 250T — full burden EUR equiv ~€79/hr'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'France';

UPDATE mhr_benchmark_rates
SET mhr_usd = 88.00,
    machine_ref = 'Amada HFE 250T — full burden EUR equiv ~€81/hr'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'W. Europe';

UPDATE mhr_benchmark_rates
SET mhr_usd = 39.00,
    machine_ref = 'Durma AD-S 250T — full burden EUR equiv ~€36/hr'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'E. Europe';

UPDATE mhr_benchmark_rates
SET mhr_usd = 80.00,
    machine_ref = 'Amada HFE 250T — full burden GBP equiv ~£63/hr'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'UK';

UPDATE mhr_benchmark_rates
SET mhr_usd = 30.00,
    machine_ref = 'Durma AD-S 250T China — full burden USD'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'China';

UPDATE mhr_benchmark_rates
SET mhr_usd = 22.00,
    machine_ref = 'Amada HFE 250T Vietnam — full burden USD'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'Vietnam';

UPDATE mhr_benchmark_rates
SET mhr_usd = 38.00,
    machine_ref = 'Amada HFE 250T Mexico — full burden USD'
WHERE machine_name = 'Press Brake 2500kN' AND location = 'Mexico';

-- ── Verification ─────────────────────────────────────────────────────────────
-- Run after deploying to confirm all kN rows are now full-burden rates:
--
-- SELECT machine_name, location, mhr_usd
-- FROM mhr_benchmark_rates
-- WHERE machine_name IN ('Press Brake 800kN','Press Brake 1500kN','Press Brake 2500kN')
-- ORDER BY machine_name, location;
--
-- Expected: no value below $9 (India 80T) or above $100 (Germany 250T).
-- USA 80T/160T/250T should be 60/70/82.
--
-- New benchmark median for USA press_brake = median(60,70,74,82) = (70+74)/2 = $72/hr
-- Guard band: $36–$216/hr — mhr_records $60 sits cleanly inside it.

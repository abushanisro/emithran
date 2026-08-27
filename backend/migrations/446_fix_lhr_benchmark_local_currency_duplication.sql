-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 446: Fix lhr_benchmark_rates.lhr — real local-currency values,
-- not a duplicate of lhr_usd_effective (2026-08-08)
--
-- Root cause of Deburr/Press Brake/Burring/Tapping silently pricing with
-- near-zero direct labor cost: migration 361's INSERT INTO lhr_benchmark_rates
-- set `lhr` (documented as "local currency/hr", read that way by
-- resolveLHRRates' Pass 2 with "no FX needed") to the SAME number as
-- `lhr_usd_effective` for EVERY non-USD location — e.g. India's Sheet Metal
-- row: lhr=1.73, lhr_usd_effective=1.73 (should be ~144 INR, not 1.73).
-- BOMItemsService.resolveLHRRates read that ₹1.73 as if it were a real local
-- rate, fed it straight into eMithranTerms() as dlrPerHr, and the FINAL
-- normalizeCostSummaryToUsd() conversion divided it by ~83.5 a SECOND time —
-- shrinking a real $1.73/hr labor rate down to a rounds-to-$0.00 fraction of
-- a cent, silently excluding direct labor from every Sheet-Metal per-cycle
-- process cost (Deburr, Press Brake, Burring, Tapping) with no warning.
--
-- bom-items.service.ts's own resolveLHRRates has ALREADY been fixed (this
-- same change) to stop reading this `lhr` column and instead convert
-- lhr_usd_effective to local currency dynamically via the live exchange
-- rate snapshot every time it's needed — that's the fix that actually
-- affects pricing, and it can't go stale as exchange_rates is updated.
--
-- This migration fixes the STORED `lhr` column too, for every OTHER
-- consumer that reads it directly and would otherwise keep showing the same
-- wrong number — confirmed live: lhr.service.ts's getBenchmarkRates()
-- (the HR Rates admin page's benchmark listing) selects `lhr` and displays
-- it as this location's labour rate.
--
-- Real, researched USD/hr values (lhr_usd_effective) are left untouched —
-- only `lhr` (local currency) is corrected, computed from the SAME
-- exchange_rates table (INR-anchored: 1 unit of from_currency = rate INR)
-- every other conversion in this app already uses — never a fresh guess.
-- USD-native rows (USA, Vietnam — both currency='USD') are correctly
-- self-consistent already and untouched by the WHERE clause below.
-- ════════════════════════════════════════════════════════════════════════════════

UPDATE lhr_benchmark_rates b
SET lhr = ROUND(
  b.lhr_usd_effective * (
    (SELECT rate FROM exchange_rates WHERE from_currency = 'USD' AND to_currency = 'INR' AND is_active LIMIT 1)
    / COALESCE(
        (SELECT rate FROM exchange_rates WHERE from_currency = b.currency AND to_currency = 'INR' AND is_active LIMIT 1),
        1  -- b.currency = 'INR' itself has no row (INR is the exchange_rates anchor, rate=1)
      )
  ),
  2
)
WHERE b.currency <> 'USD'
  AND b.lhr_usd_effective IS NOT NULL
  AND b.lhr_usd_effective > 0;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, process_group, currency, lhr, lhr_usd_effective
-- FROM lhr_benchmark_rates WHERE location = 'India' ORDER BY process_group;
-- Expect India's Sheet Metal row: lhr ≈ 144.46 (INR), lhr_usd_effective = 1.73
-- (unchanged) — lhr / lhr_usd_effective should ≈ the live USD→INR rate
-- (~83.5) for every non-USD row, not 1.00.

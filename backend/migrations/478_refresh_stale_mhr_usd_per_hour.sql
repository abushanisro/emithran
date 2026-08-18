-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 478: Refresh stale mhr_records.mhr_usd_per_hour from the CURRENT
-- budget exchange rate (2026-08-18)
--
-- Root cause, confirmed live: the "Edit Process Cost" dialog's Applied Rates
-- card (effectiveMachineRate, a true-USD value, × usdToDisplayRate) and the
-- Machine Selector's "Available now" candidate list (server-converted
-- straight from mhr_records.total_machine_hour_rate via toUsdRate) showed two
-- DIFFERENT INR figures for the exact same real machine — Salvagnini L3-30
-- Fiber, India:
--   mhr_records: total_machine_hour_rate=1605.50 (INR), mhr_usd_per_hour=19.00
--   1605.50 / 19.00 = 84.50  <-- the rate mhr_usd_per_hour was computed with
--   current active budget rate (exchange_rates, USD->INR): 83.50
-- mhr_usd_per_hour is a CACHED conversion of total_machine_hour_rate, computed
-- once (migration 435, or whatever process originally populated it) against
-- whatever the budget rate was AT THAT TIME, and never refreshed when the
-- admin-maintained budget rate later changed. Nothing re-derives it live, so
-- every reader that trusts mhr_usd_per_hour (ProcessCostDialog's
-- resolveMhrUsdRate) silently drifts out of sync with every reader that
-- re-converts total_machine_hour_rate fresh via the CURRENT rate (the
-- Machine Selector's server-side toUsdRate conversion) -- same bug class as
-- migration 475 (process_cost_records.machine_rate going stale against its
-- own linked mhr_records row), one layer further upstream.
--
-- A survey of all 1000 non-USD mhr_records rows (2026-08-18) found this is
-- NOT an isolated row: 731 INR-currency rows all show an identical implied
-- rate of exactly 84.50 (impossible to happen by chance across hundreds of
-- unrelated machines -- proof of a single bulk computation at one point in
-- time), while the live budget rate is now 83.50. CNY/MXN/GBP/EUR rows'
-- implied rates already agree with the current budget table within normal
-- rounding noise, so this migration is written generally (recompute from the
-- live exchange_rates table for ANY currency, not hardcoded to INR) but will
-- only visibly change the ~730 INR rows today.
--
-- Unlike migration 435 (which only filled NULLs), this OVERWRITES every
-- non-USD row's mhr_usd_per_hour with a fresh conversion, since the actual
-- defect is a populated-but-stale value, not a missing one. Uses the exact
-- same INR-pivoted lookup as 435 -- no hardcoded FX numbers.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── USD-native rows: mhr_usd_per_hour must equal total_machine_hour_rate exactly ──
UPDATE mhr_records
SET mhr_usd_per_hour = total_machine_hour_rate
WHERE currency = 'USD'
  AND total_machine_hour_rate IS NOT NULL
  AND mhr_usd_per_hour IS DISTINCT FROM total_machine_hour_rate;

-- ── Every other currency: refresh via the live exchange_rates table, INR-pivoted ─
WITH candidates AS (
  SELECT m.id, m.currency, m.total_machine_hour_rate, m.mhr_usd_per_hour AS old_usd
  FROM mhr_records m
  WHERE m.currency IS NOT NULL
    AND m.currency <> 'USD'
    AND m.total_machine_hour_rate IS NOT NULL
),
usd_to_inr AS (
  SELECT rate FROM exchange_rates
  WHERE is_active = true AND from_currency = 'USD' AND to_currency = 'INR'
  LIMIT 1
),
resolved AS (
  SELECT
    c.id, c.total_machine_hour_rate, c.old_usd,
    u.rate AS usd_to_inr_rate,
    CASE
      WHEN c.currency = 'INR' THEN 1
      ELSE (
        SELECT er.rate FROM exchange_rates er
        WHERE er.is_active = true AND er.from_currency = c.currency AND er.to_currency = 'INR'
        LIMIT 1
      )
    END AS local_to_inr_rate
  FROM candidates c
  CROSS JOIN usd_to_inr u
)
UPDATE mhr_records m
SET mhr_usd_per_hour = ROUND((r.total_machine_hour_rate * r.local_to_inr_rate / r.usd_to_inr_rate)::numeric, 4)
FROM resolved r
WHERE m.id = r.id
  AND r.usd_to_inr_rate IS NOT NULL     -- exchange_rates has no active USD->INR rate — skipped, not guessed
  AND r.local_to_inr_rate IS NOT NULL   -- exchange_rates has no active rate for this row's currency — skipped
  AND r.old_usd IS DISTINCT FROM ROUND((r.total_machine_hour_rate * r.local_to_inr_rate / r.usd_to_inr_rate)::numeric, 4);

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, machine_name, total_machine_hour_rate, mhr_usd_per_hour,
--        ROUND(total_machine_hour_rate / mhr_usd_per_hour, 2) AS implied_rate
--   FROM mhr_records WHERE machine_name = 'Salvagnini L3-30 Fiber' AND location = 'India';
-- Expect mhr_usd_per_hour ≈ 19.2275, implied_rate = 83.50 (matches the current
-- budget rate exactly, and 19.2275 * 83.50 = 1605.50 — now agreeing with
-- total_machine_hour_rate exactly, same number the Machine Selector shows).
--
-- IMPORTANT: run migration 475 (backfill_stale_process_cost_usd_rates) AFTER
-- this one — any already-saved process_cost_records row was synced against
-- the OLD (stale) mhr_usd_per_hour and needs to be re-synced against this
-- corrected value.

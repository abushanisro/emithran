-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 435: Backfill missing mhr_records.mhr_usd_per_hour, live FX only
-- (2026-08-08)
--
-- Root cause, confirmed by a live query on the Vietnam waterjet row the "HR
-- Rates" page was showing as "$471,560.00/hr":
--   {"location":"Vietnam","machine_name":"Waterjet Cutting Machine (60,000 PSI)",
--    "currency":"VND","landed_machine_cost":"3914100000",
--    "manual_mhr_value":"471560","total_machine_hour_rate":"471560.00",
--    "mhr_usd_per_hour":null}
-- This is NOT a capital-cost-used-as-hourly-rate bug (landed_machine_cost is a
-- separate, real 3.9-billion-VND figure, unrelated to what's displayed).
-- total_machine_hour_rate=471560 is a real, correctly-computed VND-denominated
-- hourly rate (≈$18-19/hr at current VND/USD — consistent with this app's own
-- other Vietnam sheet-metal machine rates: Fiber Laser $19/hr, Press Brake
-- $15/hr, CNC Turret Punch $16/hr, migration 361). The bug is that whatever
-- process created this row (bypassing mhr.service.ts's
-- computeUsdAndBurdenedRates(), the only code path that populates
-- mhr_usd_per_hour) left it NULL — so the "HR Rates" page's Total OH column
-- (app/(dashboard)/hr-rates/page.tsx:392: `mhrUsdPerHour ?? manualMHRValue`)
-- falls back to the raw LOCAL-currency number displayed under a "$" label.
--
-- Same bug class as migration 434 (hole_forming) and
-- src/database/migrations/327 (Combined-format import rows) — this migration
-- generalizes the fix to EVERY mhr_records row with the same gap, not just the
-- one row that happened to get noticed on the HR Rates page. The conversion
-- rate is read LIVE from the exchange_rates table (327's own pattern, INR-
-- pivoted) — no hardcoded FX numbers. A row whose currency has no active rate
-- in exchange_rates is left untouched, not guessed at.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Preview (safe to run standalone before the UPDATE) — rows this migration
-- will touch, and rows it will SKIP because exchange_rates has no live rate
-- for their currency yet:
--
-- SELECT m.location, m.currency, count(*) AS rows,
--   bool_or(m.currency = 'USD' OR er.rate IS NOT NULL) AS has_rate
-- FROM mhr_records m
-- LEFT JOIN exchange_rates er ON er.from_currency = m.currency AND er.to_currency = 'INR' AND er.is_active = true
-- WHERE m.mhr_usd_per_hour IS NULL AND m.currency IS NOT NULL AND m.total_machine_hour_rate IS NOT NULL
-- GROUP BY m.location, m.currency
-- ORDER BY has_rate, m.location;

-- ── USD-native rows: no conversion needed, just copy the value across ─────────
UPDATE mhr_records
SET mhr_usd_per_hour = total_machine_hour_rate
WHERE mhr_usd_per_hour IS NULL
  AND currency = 'USD'
  AND total_machine_hour_rate IS NOT NULL;

-- ── Every other currency: convert via the live exchange_rates table, pivoted
--    through INR exactly like migration 327's own USD->local conversion, just
--    inverted (local->USD here instead of USD->local there) ───────────────────
WITH candidates AS (
  SELECT m.id, m.currency, m.total_machine_hour_rate
  FROM mhr_records m
  WHERE m.mhr_usd_per_hour IS NULL
    AND m.currency IS NOT NULL
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
    c.id, c.total_machine_hour_rate,
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
  AND r.usd_to_inr_rate IS NOT NULL    -- exchange_rates has no active USD->INR rate — skipped, not guessed
  AND r.local_to_inr_rate IS NOT NULL; -- exchange_rates has no active rate for this row's currency — skipped

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT location, currency, total_machine_hour_rate, mhr_usd_per_hour
--   FROM mhr_records WHERE location = 'Vietnam' AND machine_name LIKE 'Waterjet Cutting Machine%';
-- Expect mhr_usd_per_hour ≈ 18-19 (real USD/hr), not 471560.
--
-- Post-check: rows still NULL are ones exchange_rates has no live rate for —
-- add that currency's rate and re-run, don't hand-enter a guessed number.
--   SELECT location, currency, count(*) FROM mhr_records
--   WHERE mhr_usd_per_hour IS NULL AND currency IS NOT NULL AND total_machine_hour_rate IS NOT NULL
--   GROUP BY location, currency;

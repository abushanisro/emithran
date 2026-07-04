-- Migration 327: Backfill mhr_records rows corrupted by the Combined_All_Countries
-- import bug (fixed in mhr.service.ts importFromExcel). Combined-format rows stored
-- the USD-denominated direct+indirect overhead rate directly into
-- fully_burdened_local_per_hr / manual_mhr_value / total_machine_hour_rate without
-- converting to the row's local currency, understating cost by the FX factor
-- (~84x for India) in every downstream cost calculation.
--
-- The conversion rate is read LIVE from the exchange_rates table at the time this
-- migration runs — no hardcoded FX numbers. Only the location -> currency CODE
-- mapping below is inline (a stable identity, e.g. "India means INR", not a rate
-- that changes over time — mirrors getCurrencyForLocation() in application code).
--
-- Signature that identifies a corrupted row: currency = 'USD' (forced by the old
-- import code) but direct_overhead_rate is populated (only the Combined format
-- writes this column) — 931 rows matched this signature at time of writing
-- (750 India, 66 Mexico, 66 China, 49 Germany).
--
-- fully_burdened_usd_per_hr was NOT corrupted (it was already correctly USD) —
-- it is the source of truth this backfill converts FROM.

BEGIN;

-- Preview (safe to run standalone before the UPDATE): rows this migration will
-- touch, and any that will be SKIPPED because exchange_rates has no rate for
-- their currency yet. Skipped rows are left untouched, not guessed at.
--
-- WITH corrupted AS (
--   SELECT m.id, m.location,
--     CASE m.location
--       WHEN 'India' THEN 'INR' WHEN 'China' THEN 'CNY'
--       WHEN 'Germany' THEN 'EUR' WHEN 'France' THEN 'EUR' WHEN 'Mexico' THEN 'MXN'
--       ELSE NULL
--     END AS local_currency
--   FROM mhr_records m
--   WHERE m.currency = 'USD' AND m.direct_overhead_rate IS NOT NULL AND m.fully_burdened_usd_per_hr IS NOT NULL
-- )
-- SELECT c.location, c.local_currency, count(*) AS rows,
--   bool_or(er.rate IS NOT NULL OR c.local_currency = 'INR') AS has_rate
-- FROM corrupted c
-- LEFT JOIN exchange_rates er ON er.from_currency = c.local_currency AND er.to_currency = 'INR' AND er.is_active = true
-- GROUP BY c.location, c.local_currency;

WITH corrupted AS (
  SELECT
    m.id,
    CASE m.location
      WHEN 'India'   THEN 'INR'
      WHEN 'China'   THEN 'CNY'
      WHEN 'Germany' THEN 'EUR'
      WHEN 'France'  THEN 'EUR'
      WHEN 'Mexico'  THEN 'MXN'
      ELSE NULL
    END AS local_currency,
    CASE m.location
      WHEN 'India'   THEN '₹'
      WHEN 'China'   THEN '¥'
      WHEN 'Germany' THEN '€'
      WHEN 'France'  THEN '€'
      WHEN 'Mexico'  THEN 'MX$'
      ELSE NULL
    END AS local_symbol,
    m.fully_burdened_usd_per_hr,
    m.shifts_per_day, m.hours_per_shift, m.working_days_per_year, m.capacity_utilization_rate
  FROM mhr_records m
  WHERE m.currency = 'USD'
    AND m.direct_overhead_rate IS NOT NULL
    AND m.fully_burdened_usd_per_hr IS NOT NULL
),
usd_to_inr AS (
  SELECT rate FROM exchange_rates
  WHERE is_active = true AND from_currency = 'USD' AND to_currency = 'INR'
  LIMIT 1
),
resolved AS (
  SELECT
    c.id, c.local_currency, c.local_symbol, c.fully_burdened_usd_per_hr,
    c.shifts_per_day, c.hours_per_shift, c.working_days_per_year, c.capacity_utilization_rate,
    u.rate AS usd_to_inr_rate,
    CASE
      WHEN c.local_currency = 'INR' THEN 1
      ELSE (
        SELECT er.rate FROM exchange_rates er
        WHERE er.is_active = true AND er.from_currency = c.local_currency AND er.to_currency = 'INR'
        LIMIT 1
      )
    END AS local_to_inr_rate
  FROM corrupted c
  CROSS JOIN usd_to_inr u
)
UPDATE mhr_records m
SET
  fully_burdened_local_per_hr = ROUND((r.fully_burdened_usd_per_hr * r.usd_to_inr_rate / r.local_to_inr_rate)::numeric, 2),
  manual_mhr_value            = ROUND((r.fully_burdened_usd_per_hr * r.usd_to_inr_rate / r.local_to_inr_rate)::numeric, 2),
  total_machine_hour_rate     = ROUND((r.fully_burdened_usd_per_hr * r.usd_to_inr_rate / r.local_to_inr_rate)::numeric, 2),
  total_fixed_cost_per_hour   = ROUND((r.fully_burdened_usd_per_hr * r.usd_to_inr_rate / r.local_to_inr_rate)::numeric, 2),
  total_annual_cost           = ROUND(
    (r.fully_burdened_usd_per_hr * r.usd_to_inr_rate / r.local_to_inr_rate)
      * r.shifts_per_day * r.hours_per_shift * r.working_days_per_year * (r.capacity_utilization_rate / 100.0)
  , 2),
  currency        = r.local_currency,
  currency_symbol = r.local_symbol
FROM resolved r
WHERE m.id = r.id
  AND r.local_currency IS NOT NULL   -- location not in the mapping above — skipped, not guessed
  AND r.usd_to_inr_rate IS NOT NULL  -- exchange_rates has no active USD->INR rate — skipped
  AND r.local_to_inr_rate IS NOT NULL; -- exchange_rates has no active rate for this local currency — skipped

COMMIT;

-- Post-check — run after the UPDATE. Any remaining rows are ones exchange_rates
-- didn't have a live rate for; add the missing currency's rate and re-run.
--   SELECT location, count(*) FROM mhr_records
--   WHERE currency = 'USD' AND direct_overhead_rate IS NOT NULL
--   GROUP BY location;
-- Expected: 0 rows.

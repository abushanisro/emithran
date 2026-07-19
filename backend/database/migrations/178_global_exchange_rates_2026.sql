-- Migration 178: Global Exchange Rates — FY2026-27 Budget Rates
--
-- Adds CNY, MXN, VND, JPY, PLN, CZK to the exchange_rates table.
-- These were previously hardcoded only in ExchangeRateService.applyDefaults().
-- After this migration they are DB-driven and can be updated by admins.
--
-- All rates: 1 unit of from_currency = N units of INR (INR-anchored model).
-- The ExchangeRateService derives cross-rates via: from_rate / to_rate.
--
-- Rate sources (FY2026-27 budget rates, not live spot):
--   CNY/INR: 11.52  — PBoC average + forward guidance for FY2026
--   MXN/INR:  4.77  — Banxico + IMF WEO April 2026
--   VND/INR:  0.0032 — SBV + 5-year trend (VND/USD × USD/INR)
--   JPY/INR:  0.56  — Bank of Japan + RBI reference
--   PLN/INR: 21.00  — NBP + EUR/INR cross (PLN ≈ 0.236 EUR)
--   CZK/INR:  3.65  — CNB + EUR/INR cross (CZK ≈ 25.4 EUR)
--
-- Safe to re-run: INSERT ... WHERE NOT EXISTS on (from_currency, to_currency).

INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_type, effective_date, is_active)
SELECT v.from_currency, v.to_currency, v.rate, v.rate_type, v.effective_date, v.is_active
FROM (VALUES
  ('CNY', 'INR', 11.52,  'BUDGET', '2026-04-01'::date, true),
  ('MXN', 'INR',  4.77,  'BUDGET', '2026-04-01'::date, true),
  ('VND', 'INR',  0.0032,'BUDGET', '2026-04-01'::date, true),
  ('JPY', 'INR',  0.56,  'BUDGET', '2026-04-01'::date, true),
  ('PLN', 'INR', 21.00,  'BUDGET', '2026-04-01'::date, true),
  ('CZK', 'INR',  3.65,  'BUDGET', '2026-04-01'::date, true)
) AS v(from_currency, to_currency, rate, rate_type, effective_date, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM exchange_rates e
  WHERE e.from_currency = v.from_currency
    AND e.to_currency   = v.to_currency
);

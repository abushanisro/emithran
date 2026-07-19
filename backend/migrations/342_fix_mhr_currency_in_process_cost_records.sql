-- Migration 342: Normalise machine_rate to USD in process_cost_records
-- ════════════════════════════════════════════════════════════════════════════════
--
-- ── PROBLEM ──────────────────────────────────────────────────────────────────
-- applyRoute was writing line.hourlyRate (local currency) directly into
-- machine_rate without converting to USD.  For India (INR) rows this means
-- machine_rate is ~83.5× too high, producing inflated cost estimates.
-- Labor_rate was already correct (lhr_usd_effective is pre-converted).
--
-- ── WHAT THIS DOES ───────────────────────────────────────────────────────────
-- Divides machine_rate by the INR exchange factor for every currency stored in
-- process_cost_records that is not already USD.  Then sets currency = 'USD'.
-- Only touches auto-filled rows (notes LIKE 'auto_fill_from_route:%').
-- manual entries are left untouched.
--
-- INR pivot rates (same values as LOCATION_INFO in default-rates.ts):
--   INR   →  ÷ 1     (India — 1 INR per INR unit, convert: ×1/83.5)
--   CNY   →  ÷ 11.52 (China — 1 CNY ≈ 11.52 INR, USD = local×11.52/83.5)
--   EUR   →  ÷ 90.8  (Germany/France/W.Europe/E.Europe)
--   GBP   →  ÷ 107.0 (UK)
--   MXN   →  ÷ 4.77  (Mexico)
-- USD and VND (Vietnam uses USD in our data) are already correct — skip them.
-- ════════════════════════════════════════════════════════════════════════════════

-- INR rows (India): machine_rate was ₹/hr, needs to become $/hr
UPDATE process_cost_records
SET
  machine_rate = ROUND((machine_rate / 83.5)::numeric, 4),
  direct_rate  = ROUND(((machine_rate / 83.5) + labor_rate)::numeric, 4),
  currency     = 'USD'
WHERE currency = 'INR'
  AND notes LIKE 'auto_fill_from_route:%';

-- CNY rows (China): 1 CNY = 11.52 INR → USD = cny × 11.52 / 83.5
UPDATE process_cost_records
SET
  machine_rate = ROUND((machine_rate * 11.52 / 83.5)::numeric, 4),
  direct_rate  = ROUND(((machine_rate * 11.52 / 83.5) + labor_rate)::numeric, 4),
  currency     = 'USD'
WHERE currency = 'CNY'
  AND notes LIKE 'auto_fill_from_route:%';

-- EUR rows (Germany / France / W. Europe / E. Europe): 1 EUR = 90.8 INR
UPDATE process_cost_records
SET
  machine_rate = ROUND((machine_rate * 90.8 / 83.5)::numeric, 4),
  direct_rate  = ROUND(((machine_rate * 90.8 / 83.5) + labor_rate)::numeric, 4),
  currency     = 'USD'
WHERE currency = 'EUR'
  AND notes LIKE 'auto_fill_from_route:%';

-- GBP rows (UK): 1 GBP = 107.0 INR
UPDATE process_cost_records
SET
  machine_rate = ROUND((machine_rate * 107.0 / 83.5)::numeric, 4),
  direct_rate  = ROUND(((machine_rate * 107.0 / 83.5) + labor_rate)::numeric, 4),
  currency     = 'USD'
WHERE currency = 'GBP'
  AND notes LIKE 'auto_fill_from_route:%';

-- MXN rows (Mexico): 1 MXN = 4.77 INR
UPDATE process_cost_records
SET
  machine_rate = ROUND((machine_rate * 4.77 / 83.5)::numeric, 4),
  direct_rate  = ROUND(((machine_rate * 4.77 / 83.5) + labor_rate)::numeric, 4),
  currency     = 'USD'
WHERE currency = 'MXN'
  AND notes LIKE 'auto_fill_from_route:%';

-- Normalise any remaining non-USD auto-fill rows (safety catch-all): treat as INR
UPDATE process_cost_records
SET
  machine_rate = ROUND((machine_rate / 83.5)::numeric, 4),
  direct_rate  = ROUND(((machine_rate / 83.5) + labor_rate)::numeric, 4),
  currency     = 'USD'
WHERE currency NOT IN ('USD', 'INR', 'CNY', 'EUR', 'GBP', 'MXN')
  AND notes LIKE 'auto_fill_from_route:%';

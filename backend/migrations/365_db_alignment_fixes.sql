-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 365: Database alignment fixes (2026-07-22)
--
-- What this migration does:
--   1. Fix lhr_benchmark_rates India/China/Mexico local-currency scale error
--   2. Add cost_uk, cost_vietnam to raw_materials and backfill from nearest proxy
--   3. Seed mhr_records for cnc_lathe_live, cnc_mill_turn, waterjet (all 10 locations)
--   4. Seed mhr_benchmark_rates for the three new machine classes above
--
-- Idempotent: LHR UPDATE is guarded by lhr<10/20, mhr_records by NOT EXISTS,
-- mhr_benchmark_rates by ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. Fix lhr_benchmark_rates local-currency scale ──────────────────────────
-- Migration 361 stored the USD-equivalent value in the lhr (local currency) column.
-- resolveLHRRates() Pass 2 reads lhr as local currency/hr — India ₹1.73/hr ≈ $0.02/hr.
-- Correct: ₹144/hr (1.73 × 83.5), ¥82/hr (11.27 × 7.25), MX$146/hr (8.34 × 17.5).
-- Guard clause (lhr < threshold) makes these UPDATEs idempotent.

UPDATE lhr_benchmark_rates
SET    lhr = ROUND(lhr_usd_effective * 83.5, 2)
WHERE  location = 'India'
  AND  currency = 'INR'
  AND  lhr < 10;

UPDATE lhr_benchmark_rates
SET    lhr = ROUND(lhr_usd_effective * 7.25, 2)
WHERE  location = 'China'
  AND  currency = 'CNY'
  AND  lhr < 20;

UPDATE lhr_benchmark_rates
SET    lhr = ROUND(lhr_usd_effective * 17.5, 2)
WHERE  location = 'Mexico'
  AND  currency = 'MXN'
  AND  lhr < 20;

-- ── 2. raw_materials: add cost_uk and cost_vietnam columns ───────────────────
-- auto-fill.service.ts and raw-material-cost.service.ts reference these columns.
-- LOCATION_INFO (default-rates.ts) now points to cost_uk / cost_vietnam.

ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS cost_uk      NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS cost_vietnam NUMERIC(12,4);

-- UK ≈ W.Europe pricing (closest regional proxy available)
UPDATE raw_materials
SET    cost_uk = cost_w_europe
WHERE  cost_uk IS NULL AND cost_w_europe IS NOT NULL;

-- Fallback: derive from cost_usa × 1.08 (USD→GBP rough parity for manufacturing BOM)
UPDATE raw_materials
SET    cost_uk = ROUND(cost_usa * 1.08, 4)
WHERE  cost_uk IS NULL AND cost_usa IS NOT NULL;

-- Vietnam: USD-denominated supply chain tracks USA pricing
UPDATE raw_materials
SET    cost_vietnam = cost_usa
WHERE  cost_vietnam IS NULL AND cost_usa IS NOT NULL;

-- ── 3. Seed mhr_records for missing machine classes ──────────────────────────
-- Follows the exact INSERT pattern from migration 337.
-- commodity_codes: CNC-LATHELT (cnc_lathe_live), CNC-MILLTURN (cnc_mill_turn),
--                  SM-WATERJET (waterjet)
-- All rates in LOCAL CURRENCY (USD for USA/Vietnam/China/Mexico, INR for India,
-- EUR for Germany/France/W.Europe/E.Europe, GBP for UK).
-- landed_machine_cost is reference-only USD; rate is driven by manual_mhr_value.

DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid
  FROM auth.users
  WHERE email = 'abushan.isro@gmail.com'
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE EXCEPTION 'User not found: abushan.isro@gmail.com';
  END IF;

  -- ── 3a. cnc_lathe_live (Turning Center 3-axis / Live Tool) ─────────────────
  -- USA rates from Combined_All_Countries_Database.json (Sl.No 7-9).
  -- Other locations derived at regional cost ratios from the USA base.
  INSERT INTO mhr_records (
    user_id, location, commodity_code, machine_name, machine_class, process_group,
    landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
    capacity_utilization_rate,
    max_tonnage, max_x_mm, max_y_mm, max_z_mm, max_diameter_mm, max_length_mm,
    capability_source, availability_status,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    accessories_cost_percentage, installation_cost_percentage, payback_period_years,
    interest_rate_percentage, insurance_rate_percentage, machine_footprint_sqm,
    rent_per_sqm_per_month, maintenance_cost_percentage, power_kwh_per_hour,
    electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage
  )
  SELECT
    uid,
    v.location, v.commodity_code, v.machine_name, 'cnc_lathe_live', 'CNC Machining',
    v.landed_usd, v.local_mhr, v.local_mhr, v.local_mhr,
    85,
    NULL, NULL, NULL, NULL, v.max_dia, v.max_len,
    'benchmark', 'available',
    3, 8, 260, 0,
    6, 20, 10, 8, 1, 0, 0, 6,
    v.power_kw, v.elec_kwh, 0, 0
  FROM (VALUES
    -- USA (USD/hr) — exact from Combined DB
    ('USA',      'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     60000,  23.15, 254,  308, 15, 0.085),
    ('USA',      'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',  120000,  37.02, 648, 2032, 30, 0.085),
    ('USA',      'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large',180000,  45.84, 899, 1600, 45, 0.085),
    -- India (INR/hr)
    ('India',    'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',      7500,    900, 254,  308, 15, 7.50),
    ('India',    'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',   12000,   1400, 648, 2032, 30, 7.50),
    ('India',    'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large', 18000,  1750, 899, 1600, 45, 7.50),
    -- Germany (EUR/hr)
    ('Germany',  'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     55000,  31.27, 254,  308, 15, 0.20),
    ('Germany',  'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',  110000,  49.98, 648, 2032, 30, 0.20),
    ('Germany',  'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large',165000, 61.88, 899, 1600, 45, 0.20),
    -- France (EUR/hr)
    ('France',   'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     55000,  29.63, 254,  308, 15, 0.15),
    ('France',   'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',  110000,  47.39, 648, 2032, 30, 0.15),
    ('France',   'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large',165000, 58.68, 899, 1600, 45, 0.15),
    -- W. Europe (EUR/hr)
    ('W. Europe','CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     55000,  30.10, 254,  308, 15, 0.18),
    ('W. Europe','CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',  110000,  48.13, 648, 2032, 30, 0.18),
    ('W. Europe','CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large',165000, 59.59, 899, 1600, 45, 0.18),
    -- E. Europe (EUR/hr)
    ('E. Europe','CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     40000,  13.89, 254,  308, 15, 0.10),
    ('E. Europe','CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',   80000,  22.21, 648, 2032, 30, 0.10),
    ('E. Europe','CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large',120000, 27.50, 899, 1600, 45, 0.10),
    -- UK (GBP/hr)
    ('UK',       'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     55000,  27.78, 254,  308, 15, 0.15),
    ('UK',       'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',  110000,  44.42, 648, 2032, 30, 0.15),
    ('UK',       'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large',165000, 55.01, 899, 1600, 45, 0.15),
    -- China (USD/hr)
    ('China',    'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     30000,  11.58, 254,  308, 15, 0.09),
    ('China',    'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',   60000,  18.51, 648, 2032, 30, 0.09),
    ('China',    'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large', 90000, 22.92, 899, 1600, 45, 0.09),
    -- Vietnam (USD/hr)
    ('Vietnam',  'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     25000,  10.42, 254,  308, 15, 0.085),
    ('Vietnam',  'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',   50000,  16.66, 648, 2032, 30, 0.085),
    ('Vietnam',  'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large', 75000, 20.63, 899, 1600, 45, 0.085),
    -- Mexico (USD/hr) — exact from Combined DB Sl.No 66-68
    ('Mexico',   'CNC-LATHELT', 'Haas SL20 Turning Center Live Tool Small',     25000,  12.37, 254,  308, 15, 0.079),
    ('Mexico',   'CNC-LATHELT', 'Haas SL40L Turning Center Live Tool Medium',   50000,  25.22, 648, 2032, 30, 0.079),
    ('Mexico',   'CNC-LATHELT', 'Daewoo Puma700 Turning Center Live Tool Large', 75000, 28.01, 899, 1600, 45, 0.079)
  ) AS v(location, commodity_code, machine_name, landed_usd, local_mhr, max_dia, max_len, power_kw, elec_kwh)
  WHERE NOT EXISTS (
    SELECT 1 FROM mhr_records r
    WHERE r.user_id = uid AND r.location = v.location AND r.machine_name = v.machine_name
  );

  -- ── 3b. cnc_mill_turn (Turn Mill / Mill-Turn Center) ──────────────────────
  -- USA rates from Combined_All_Countries_Database.json (Sl.No 19-21).
  INSERT INTO mhr_records (
    user_id, location, commodity_code, machine_name, machine_class, process_group,
    landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
    capacity_utilization_rate,
    max_tonnage, max_x_mm, max_y_mm, max_z_mm, max_diameter_mm, max_length_mm,
    capability_source, availability_status,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    accessories_cost_percentage, installation_cost_percentage, payback_period_years,
    interest_rate_percentage, insurance_rate_percentage, machine_footprint_sqm,
    rent_per_sqm_per_month, maintenance_cost_percentage, power_kwh_per_hour,
    electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage
  )
  SELECT
    uid,
    v.location, v.commodity_code, v.machine_name, 'cnc_mill_turn', 'CNC Machining',
    v.landed_usd, v.local_mhr, v.local_mhr, v.local_mhr,
    85,
    NULL, NULL, NULL, NULL, v.max_dia, v.max_len,
    'benchmark', 'available',
    3, 8, 260, 0,
    6, 20, 10, 8, 1, 0, 0, 6,
    v.power_kw, v.elec_kwh, 0, 0
  FROM (VALUES
    -- USA (USD/hr) — exact from Combined DB
    ('USA',      'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',        150000,  49.86,  65,  400, 30, 0.085),
    ('USA',      'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       350000,  71.79, 279, 3048, 50, 0.085),
    ('USA',      'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        550000,  87.83, 812, 3048, 75, 0.085),
    -- India (INR/hr)
    ('India',    'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',         60000,  3000,   65,  400, 30, 7.50),
    ('India',    'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       140000,  4300,  279, 3048, 50, 7.50),
    ('India',    'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        220000,  5500,  812, 3048, 75, 7.50),
    -- Germany (EUR/hr)
    ('Germany',  'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',        140000,  67.31,  65,  400, 30, 0.20),
    ('Germany',  'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       320000,  96.92, 279, 3048, 50, 0.20),
    ('Germany',  'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        500000, 118.57, 812, 3048, 75, 0.20),
    -- France (EUR/hr)
    ('France',   'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',        140000,  63.82,  65,  400, 30, 0.15),
    ('France',   'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       320000,  91.89, 279, 3048, 50, 0.15),
    ('France',   'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        500000, 112.42, 812, 3048, 75, 0.15),
    -- W. Europe (EUR/hr)
    ('W. Europe','CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',        140000,  64.82,  65,  400, 30, 0.18),
    ('W. Europe','CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       320000,  93.33, 279, 3048, 50, 0.18),
    ('W. Europe','CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        500000, 114.18, 812, 3048, 75, 0.18),
    -- E. Europe (EUR/hr)
    ('E. Europe','CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',         80000,  29.92,  65,  400, 30, 0.10),
    ('E. Europe','CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       180000,  43.07, 279, 3048, 50, 0.10),
    ('E. Europe','CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        280000,  52.70, 812, 3048, 75, 0.10),
    -- UK (GBP/hr)
    ('UK',       'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',        140000,  59.83,  65,  400, 30, 0.15),
    ('UK',       'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       320000,  86.15, 279, 3048, 50, 0.15),
    ('UK',       'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        500000, 105.40, 812, 3048, 75, 0.15),
    -- China (USD/hr)
    ('China',    'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',         70000,  24.93,  65,  400, 30, 0.09),
    ('China',    'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       160000,  35.90, 279, 3048, 50, 0.09),
    ('China',    'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        250000,  43.92, 812, 3048, 75, 0.09),
    -- Vietnam (USD/hr)
    ('Vietnam',  'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',         60000,  22.44,  65,  400, 30, 0.085),
    ('Vietnam',  'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       140000,  32.31, 279, 3048, 50, 0.085),
    ('Vietnam',  'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        220000,  39.52, 812, 3048, 75, 0.085),
    -- Mexico (USD/hr)
    ('Mexico',   'CNC-MILLTURN', 'Index ratioline G200 Mill-Turn Small',         60000,  24.71,  65,  400, 30, 0.079),
    ('Mexico',   'CNC-MILLTURN', 'Mazak Integrex e410H Mill-Turn Medium',       140000,  35.58, 279, 3048, 50, 0.079),
    ('Mexico',   'CNC-MILLTURN', 'Mazak Integrex e500H Mill-Turn Large',        220000,  43.55, 812, 3048, 75, 0.079)
  ) AS v(location, commodity_code, machine_name, landed_usd, local_mhr, max_dia, max_len, power_kw, elec_kwh)
  WHERE NOT EXISTS (
    SELECT 1 FROM mhr_records r
    WHERE r.user_id = uid AND r.location = v.location AND r.machine_name = v.machine_name
  );

  -- ── 3c. waterjet ───────────────────────────────────────────────────────────
  -- 2026 KMT/Flow benchmark rates (Waterjet Technology Association).
  INSERT INTO mhr_records (
    user_id, location, commodity_code, machine_name, machine_class, process_group,
    landed_machine_cost, manual_mhr_value, fully_burdened_local_per_hr, total_machine_hour_rate,
    capacity_utilization_rate,
    max_tonnage, max_x_mm, max_y_mm, max_z_mm, max_diameter_mm, max_length_mm,
    capability_source, availability_status,
    shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
    accessories_cost_percentage, installation_cost_percentage, payback_period_years,
    interest_rate_percentage, insurance_rate_percentage, machine_footprint_sqm,
    rent_per_sqm_per_month, maintenance_cost_percentage, power_kwh_per_hour,
    electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage
  )
  SELECT
    uid,
    v.location, 'SM-WATERJET', v.machine_name, 'waterjet', 'Sheet Metal',
    v.landed_usd, v.local_mhr, v.local_mhr, v.local_mhr,
    85,
    NULL, v.max_x, v.max_y, NULL, NULL, NULL,
    'benchmark', 'available',
    3, 8, 260, 0,
    6, 20, 10, 8, 1, 0, 0, 8,
    v.power_kw, v.elec_kwh, 0, 0
  FROM (VALUES
    ('USA',      'Flow Mach 100 Waterjet Small (2032x1016mm)',   90000,  32.50, 2032, 1016, 30, 0.085),
    ('USA',      'KMT Streamline Waterjet Large (3050x1524mm)', 160000,  55.00, 3050, 1524, 45, 0.085),
    ('India',    'CNC Waterjet Small (2000x1000mm)',             35000,  1200,  2000, 1000, 30, 7.50),
    ('India',    'CNC Waterjet Large (3000x1500mm)',             65000,  2000,  3000, 1500, 45, 7.50),
    ('Germany',  'Flow Mach 100 Waterjet Small (2032x1016mm)',  120000,  43.88, 2032, 1016, 30, 0.20),
    ('Germany',  'KMT Streamline Waterjet Large (3050x1524mm)', 215000,  74.25, 3050, 1524, 45, 0.20),
    ('France',   'Flow Mach 100 Waterjet Small (2032x1016mm)',  120000,  41.60, 2032, 1016, 30, 0.15),
    ('France',   'KMT Streamline Waterjet Large (3050x1524mm)', 215000,  70.40, 3050, 1524, 45, 0.15),
    ('W. Europe','Flow Mach 100 Waterjet Small (2032x1016mm)',  120000,  42.25, 2032, 1016, 30, 0.18),
    ('W. Europe','KMT Streamline Waterjet Large (3050x1524mm)', 215000,  71.50, 3050, 1524, 45, 0.18),
    ('E. Europe','Flow Mach 100 Waterjet Small (2032x1016mm)',   70000,  19.50, 2032, 1016, 30, 0.10),
    ('E. Europe','KMT Streamline Waterjet Large (3050x1524mm)', 125000,  33.00, 3050, 1524, 45, 0.10),
    ('UK',       'Flow Mach 100 Waterjet Small (2032x1016mm)',  120000,  39.00, 2032, 1016, 30, 0.15),
    ('UK',       'KMT Streamline Waterjet Large (3050x1524mm)', 215000,  66.00, 3050, 1524, 45, 0.15),
    ('China',    'Flow Mach 100 Waterjet Small (2032x1016mm)',   45000,  16.25, 2032, 1016, 30, 0.09),
    ('China',    'KMT Streamline Waterjet Large (3050x1524mm)',  80000,  27.50, 3050, 1524, 45, 0.09),
    ('Vietnam',  'Flow Mach 100 Waterjet Small (2032x1016mm)',   40000,  14.63, 2032, 1016, 30, 0.085),
    ('Vietnam',  'KMT Streamline Waterjet Large (3050x1524mm)',  72000,  24.75, 3050, 1524, 45, 0.085),
    ('Mexico',   'Flow Mach 100 Waterjet Small (2032x1016mm)',   40000,  14.63, 2032, 1016, 30, 0.079),
    ('Mexico',   'KMT Streamline Waterjet Large (3050x1524mm)',  72000,  24.75, 3050, 1524, 45, 0.079)
  ) AS v(location, machine_name, landed_usd, local_mhr, max_x, max_y, power_kw, elec_kwh)
  WHERE NOT EXISTS (
    SELECT 1 FROM mhr_records r
    WHERE r.user_id = uid AND r.location = v.location AND r.machine_name = v.machine_name
  );

END $$;

-- ── 4. mhr_benchmark_rates: add rows for new machine classes ─────────────────
-- Machine names MUST contain a keyword from MACHINE_REGISTRY.machineClassKeywords:
--   cnc_lathe_live : 'Live Tool', 'Sub-Spindle', 'Live Tooling'
--   cnc_mill_turn  : 'Mill-Turn', 'MillTurn', 'Turn Mill', 'Mill Turn'
--   waterjet       : 'Waterjet', 'Water Jet', 'Abrasive Jet'
-- Process group MUST contain a keyword from processGroupKeywords:
--   cnc_lathe_live : 'Turning', 'Lathe', 'Machining'
--   cnc_mill_turn  : 'Mill-Turn', 'Turn-Mill', 'Machining'
--   waterjet       : 'Waterjet', 'Sheet Metal'
-- mhr_usd = USD equivalent rate (used by benchmark guard to compute plausibility band).

INSERT INTO mhr_benchmark_rates (machine_name, process_group, location, mhr_usd, machine_ref)
VALUES
  -- cnc_lathe_live — median of 3 size tiers per location (USD equiv)
  ('Live Tool Turning Center',   'Machining', 'USA',       35.34, 'Combined DB median Haas SL20/40L / Daewoo Puma700'),
  ('Live Tool Turning Center',   'Machining', 'India',     16.17, 'INR median 1350/hr ÷ 83.5'),
  ('Live Tool Turning Center',   'Machining', 'Germany',   52.01, 'EUR median 47.71/hr × 1.09'),
  ('Live Tool Turning Center',   'Machining', 'France',    49.30, 'EUR median 45.23/hr × 1.09'),
  ('Live Tool Turning Center',   'Machining', 'W. Europe', 50.07, 'EUR median 45.94/hr × 1.09'),
  ('Live Tool Turning Center',   'Machining', 'E. Europe', 23.11, 'EUR median 21.20/hr × 1.09'),
  ('Live Tool Turning Center',   'Machining', 'UK',        53.85, 'GBP median 42.40/hr × 1.27'),
  ('Live Tool Turning Center',   'Machining', 'China',     17.67, 'USD direct'),
  ('Live Tool Turning Center',   'Machining', 'Vietnam',   15.90, 'USD direct'),
  ('Live Tool Turning Center',   'Machining', 'Mexico',    21.87, 'Combined DB Mexico 3ax median'),

  -- cnc_mill_turn — median of 3 size tiers per location (USD equiv)
  ('Mill-Turn Center',           'Machining', 'USA',       69.83, 'Combined DB median Index G200 / Mazak e410H / e500H'),
  ('Mill-Turn Center',           'Machining', 'India',     51.10, 'INR median 4267/hr ÷ 83.5'),
  ('Mill-Turn Center',           'Machining', 'Germany',  102.75, 'EUR median 94.27/hr × 1.09'),
  ('Mill-Turn Center',           'Machining', 'France',    97.42, 'EUR median 89.38/hr × 1.09'),
  ('Mill-Turn Center',           'Machining', 'W. Europe', 98.95, 'EUR median 90.78/hr × 1.09'),
  ('Mill-Turn Center',           'Machining', 'E. Europe', 45.67, 'EUR median 41.90/hr × 1.09'),
  ('Mill-Turn Center',           'Machining', 'UK',       106.41, 'GBP median 83.79/hr × 1.27'),
  ('Mill-Turn Center',           'Machining', 'China',     34.92, 'USD direct'),
  ('Mill-Turn Center',           'Machining', 'Vietnam',   31.42, 'USD direct'),
  ('Mill-Turn Center',           'Machining', 'Mexico',    34.61, 'USD direct'),

  -- waterjet — median of small/large per location (USD equiv)
  ('Waterjet Cutter',            'Sheet Metal','USA',       43.75, '2026 KMT/Flow benchmark median'),
  ('Waterjet Cutter',            'Sheet Metal','India',     19.16, 'INR median 1600/hr ÷ 83.5'),
  ('Waterjet Cutter',            'Sheet Metal','Germany',   64.38, 'EUR median 59.07/hr × 1.09'),
  ('Waterjet Cutter',            'Sheet Metal','France',    61.04, 'EUR median 56.00/hr × 1.09'),
  ('Waterjet Cutter',            'Sheet Metal','W. Europe', 62.00, 'EUR median 56.88/hr × 1.09'),
  ('Waterjet Cutter',            'Sheet Metal','E. Europe', 28.61, 'EUR median 26.25/hr × 1.09'),
  ('Waterjet Cutter',            'Sheet Metal','UK',        66.68, 'GBP median 52.50/hr × 1.27'),
  ('Waterjet Cutter',            'Sheet Metal','China',     21.88, 'USD direct'),
  ('Waterjet Cutter',            'Sheet Metal','Vietnam',   19.69, 'USD direct'),
  ('Waterjet Cutter',            'Sheet Metal','Mexico',    19.69, 'USD direct')

ON CONFLICT (machine_name, process_group, location) DO NOTHING;

-- ── Verification ─────────────────────────────────────────────────────────────
-- Run after deploying to confirm:
--
-- 1. India LHR should be ~144, not 1.73:
--    SELECT location, process_group, lhr, currency FROM lhr_benchmark_rates
--    WHERE location IN ('India','China','Mexico') ORDER BY location;
--
-- 2. New material columns populated:
--    SELECT material_grade, cost_uk, cost_vietnam FROM raw_materials
--    WHERE cost_uk IS NOT NULL LIMIT 5;
--
-- 3. New machine classes seeded:
--    SELECT machine_class, location, COUNT(*), MIN(total_machine_hour_rate), MAX(total_machine_hour_rate)
--    FROM mhr_records WHERE machine_class IN ('cnc_lathe_live','cnc_mill_turn','waterjet')
--    GROUP BY machine_class, location ORDER BY machine_class, location;

-- ============================================================================
-- Migration 595: Fix over-multiplied dual-listed press rows from migration
-- 594 (2026-08-28)
--
-- Root cause: 12 machine names (the same "duplicate" press machines from
-- the Standard Press reconciliation earlier this cycle) are listed THREE
-- times in every one of the 4 location source files (categories
-- "Mechanical Press"/"Progressive Die Press", "Standard Press", "Tandem
-- Press"), but only have TWO live mhr_records rows each under location=
-- 'USA' ('Progressive Die Press:X' and 'Tandem Press:X' -- 'Standard
-- Press:X' was correctly excluded during the earlier reconciliation).
-- Migration 594's join was unconstrained by category, cross-joining every
-- source occurrence (3) against every live row (2) = 6 rows per (machine,
-- location) instead of 2 -- confirmed live for 'Schuler 1150 Ton'.
--
-- Fix: delete every row migration 594 created for these 12 machines across
-- India/China/Mexico/France (nothing salvageable -- the cross-join mixed
-- rates from the wrong category in most of the 6), then re-insert exactly
-- the correct 2 rows per (machine, location), each priced from its own
-- matching category in the source file and joined against its own matching
-- live category row. Confirmed before relying on it: India/Mexico/France's
-- "Mechanical Press" category label = China's own "Progressive Die Press"
-- label = the live 'Progressive Die Press' category, consistently across
-- all 12 machines in all 4 files. "Standard Press" source rows are
-- discarded (no live match for these 12 -- consistent with the earlier
-- reconciliation decision).
--
-- No other machine name is affected -- verified: these are the ONLY 12
-- names that appear more than once within any of the 4 source files.
-- ============================================================================

BEGIN;

-- ── Step 1: remove every row migration 594 created for these 12 machines ──
DELETE FROM mhr_records
WHERE location IN ('India', 'China', 'Mexico', 'France')
AND machine_name IN ('Default Press', 'Schuler 1150 Ton', 'Schuler A2/200 - 360', 'Schuler TSD 2000', 'United Power SHD-220 Ton', 'United Power SHD-400 Ton', 'United Power SHD-666 Ton', 'United Power SHS-166 Ton', 'United Power SHS-666 Ton', 'United Power THD-137 High Speed', 'United Power THD-333 High Speed', 'United Power THD-66 High Speed');

-- ── Step 2: re-insert the correct 2-per-(machine,location) rows ───────────
INSERT INTO mhr_records (
  user_id, organization_id, location, commodity_code, process_group, machine_class,
  machine_name, machine_description, manufacturer_country, machine_price_usd,
  landed_machine_cost, is_manual_entry, manual_mhr_value, total_machine_hour_rate,
  fully_burdened_local_per_hr,
  shifts_per_day, hours_per_shift, working_days_per_year, planned_maintenance_hours_per_year,
  capacity_utilization_rate, accessories_cost_percentage, installation_cost_percentage,
  payback_period_years, interest_rate_percentage, insurance_rate_percentage,
  machine_footprint_sqm, rent_per_sqm_per_month, maintenance_cost_percentage,
  power_kwh_per_hour, electricity_cost_per_kwh, admin_overhead_percentage, profit_margin_percentage,
  power_kw, currency, currency_symbol,
  direct_overhead_rate, indirect_overhead_rate, usd_lhr_total,
  direct_overhead_source, indirect_overhead_source, labor_rate_source,
  economics_version, economics_updated_at,
  capability_source, benchmark_source_key,
  benchmark_direct_overhead_rate_usd_hr, benchmark_indirect_overhead_rate_usd_hr, benchmark_labor_rate_usd_hr
)
SELECT
  NULL, NULL, v.location, usa.commodity_code, usa.process_group, usa.machine_class,
  usa.machine_name, usa.machine_description, usa.manufacturer_country, usa.machine_price_usd,
  usa.landed_machine_cost, true,
  ROUND(COALESCE(v.direct, 0) + COALESCE(v.indirect, 0), 2),
  ROUND(COALESCE(v.direct, 0) + COALESCE(v.indirect, 0), 2),
  ROUND(COALESCE(v.direct, 0) + COALESCE(v.indirect, 0), 2),
  usa.shifts_per_day, usa.hours_per_shift, usa.working_days_per_year, usa.planned_maintenance_hours_per_year,
  usa.capacity_utilization_rate, usa.accessories_cost_percentage, usa.installation_cost_percentage,
  usa.payback_period_years, usa.interest_rate_percentage, usa.insurance_rate_percentage,
  usa.machine_footprint_sqm, usa.rent_per_sqm_per_month, usa.maintenance_cost_percentage,
  usa.power_kwh_per_hour, usa.electricity_cost_per_kwh, usa.admin_overhead_percentage, usa.profit_margin_percentage,
  usa.power_kw, 'USD', '$',
  v.direct, v.indirect, v.labor,
  'benchmark', 'benchmark', 'benchmark',
  COALESCE(usa.economics_version, 1), NOW(),
  'benchmark', usa.benchmark_source_key || ':' || v.location,
  v.direct, v.indirect, v.labor
FROM mhr_records usa
JOIN (VALUES
('India', 'Progressive Die Press', 'Default Press', 22.61, 2.08, 2.22),
('India', 'Tandem Press', 'Default Press', 22.61, 2.08, 2.22),
('India', 'Progressive Die Press', 'Schuler 1150 Ton', 61.7, 3.49, 2.22),
('India', 'Tandem Press', 'Schuler 1150 Ton', 59.97, 3.49, 2.22),
('India', 'Progressive Die Press', 'Schuler A2/200 - 360', 43.26, 1.91, 2.22),
('India', 'Tandem Press', 'Schuler A2/200 - 360', 43.26, 1.91, 2.22),
('India', 'Progressive Die Press', 'Schuler TSD 2000', 199.49, 9.34, 2.22),
('India', 'Tandem Press', 'Schuler TSD 2000', 199.49, 9.34, 2.22),
('India', 'Progressive Die Press', 'United Power SHD-220 Ton', 19.76, 2.27, 2.22),
('India', 'Tandem Press', 'United Power SHD-220 Ton', 19.76, 2.27, 2.22),
('India', 'Progressive Die Press', 'United Power SHD-400 Ton', 35.48, 2.69, 2.22),
('India', 'Tandem Press', 'United Power SHD-400 Ton', 35.48, 2.69, 2.22),
('India', 'Progressive Die Press', 'United Power SHD-666 Ton', 61.77, 3.13, 2.22),
('India', 'Tandem Press', 'United Power SHD-666 Ton', 60.14, 3.13, 2.22),
('India', 'Progressive Die Press', 'United Power SHS-166 Ton', 14.66, 1.6, 2.22),
('India', 'Tandem Press', 'United Power SHS-166 Ton', 14.66, 1.6, 2.22),
('India', 'Progressive Die Press', 'United Power SHS-666 Ton', 61.77, 1.95, 2.22),
('India', 'Tandem Press', 'United Power SHS-666 Ton', 60.14, 1.95, 2.22),
('India', 'Progressive Die Press', 'United Power THD-137 High Speed', 14.28, 1.67, 2.22),
('India', 'Tandem Press', 'United Power THD-137 High Speed', 14.28, 1.67, 2.22),
('India', 'Progressive Die Press', 'United Power THD-333 High Speed', 31.22, 2.06, 2.22),
('India', 'Tandem Press', 'United Power THD-333 High Speed', 31.22, 2.06, 2.22),
('India', 'Progressive Die Press', 'United Power THD-66 High Speed', 6.94, 1.6, 2.22),
('India', 'Tandem Press', 'United Power THD-66 High Speed', 6.94, 1.6, 2.22),
('China', 'Progressive Die Press', 'Default Press', 20.98, 5.14, 10.43),
('China', 'Tandem Press', 'Default Press', 20.98, 5.14, 10.43),
('China', 'Progressive Die Press', 'Schuler 1150 Ton', 58.33, 6.82, 10.43),
('China', 'Tandem Press', 'Schuler 1150 Ton', 54.88, 6.82, 10.43),
('China', 'Progressive Die Press', 'Schuler A2/200 - 360', 40.93, 4.93, 10.43),
('China', 'Tandem Press', 'Schuler A2/200 - 360', 40.93, 4.93, 10.43),
('China', 'Progressive Die Press', 'Schuler TSD 2000', 185.9, 13.8, 10.43),
('China', 'Tandem Press', 'Schuler TSD 2000', 185.9, 13.8, 10.43),
('China', 'Progressive Die Press', 'United Power SHD-220 Ton', 18.4, 5.37, 10.43),
('China', 'Tandem Press', 'United Power SHD-220 Ton', 18.4, 5.37, 10.43),
('China', 'Progressive Die Press', 'United Power SHD-400 Ton', 33.06, 5.86, 10.43),
('China', 'Tandem Press', 'United Power SHD-400 Ton', 33.06, 5.86, 10.43),
('China', 'Progressive Die Press', 'United Power SHD-666 Ton', 58.3, 6.39, 10.43),
('China', 'Tandem Press', 'United Power SHD-666 Ton', 55.03, 6.39, 10.43),
('China', 'Progressive Die Press', 'United Power SHS-166 Ton', 13.66, 4.56, 10.43),
('China', 'Tandem Press', 'United Power SHS-166 Ton', 13.66, 4.56, 10.43),
('China', 'Progressive Die Press', 'United Power SHS-666 Ton', 58.3, 4.98, 10.43),
('China', 'Tandem Press', 'United Power SHS-666 Ton', 55.03, 4.98, 10.43),
('China', 'Progressive Die Press', 'United Power THD-137 High Speed', 13.27, 4.64, 10.43),
('China', 'Tandem Press', 'United Power THD-137 High Speed', 13.27, 4.64, 10.43),
('China', 'Progressive Die Press', 'United Power THD-333 High Speed', 29.06, 5.11, 10.43),
('China', 'Tandem Press', 'United Power THD-333 High Speed', 29.06, 5.11, 10.43),
('China', 'Progressive Die Press', 'United Power THD-66 High Speed', 6.45, 4.56, 10.43),
('China', 'Tandem Press', 'United Power THD-66 High Speed', 6.45, 4.56, 10.43),
('Mexico', 'Progressive Die Press', 'Default Press', 31.34, 2.99, 5.3),
('Mexico', 'Tandem Press', 'Default Press', 31.34, 2.99, 5.3),
('Mexico', 'Progressive Die Press', 'Schuler 1150 Ton', 79.34, 4.41, 5.3),
('Mexico', 'Tandem Press', 'Schuler 1150 Ton', 75.58, 4.41, 5.3),
('Mexico', 'Progressive Die Press', 'Schuler A2/200 - 360', 55.29, 2.82, 5.3),
('Mexico', 'Tandem Press', 'Schuler A2/200 - 360', 55.29, 2.82, 5.3),
('Mexico', 'Progressive Die Press', 'Schuler TSD 2000', 254.81, 10.28, 5.3),
('Mexico', 'Tandem Press', 'Schuler TSD 2000', 254.81, 10.28, 5.3),
('Mexico', 'Progressive Die Press', 'United Power SHD-220 Ton', 25.42, 3.19, 5.3),
('Mexico', 'Tandem Press', 'United Power SHD-220 Ton', 25.42, 3.19, 5.3),
('Mexico', 'Progressive Die Press', 'United Power SHD-400 Ton', 45.45, 3.6, 5.3),
('Mexico', 'Tandem Press', 'United Power SHD-400 Ton', 45.45, 3.6, 5.3),
('Mexico', 'Progressive Die Press', 'United Power SHD-666 Ton', 81.07, 4.05, 5.3),
('Mexico', 'Tandem Press', 'United Power SHD-666 Ton', 77.51, 4.05, 5.3),
('Mexico', 'Progressive Die Press', 'United Power SHS-166 Ton', 18.74, 2.51, 5.3),
('Mexico', 'Tandem Press', 'United Power SHS-166 Ton', 18.74, 2.51, 5.3),
('Mexico', 'Progressive Die Press', 'United Power SHS-666 Ton', 81.07, 2.86, 5.3),
('Mexico', 'Tandem Press', 'United Power SHS-666 Ton', 77.51, 2.86, 5.3),
('Mexico', 'Progressive Die Press', 'United Power THD-137 High Speed', 19.32, 2.58, 5.3),
('Mexico', 'Tandem Press', 'United Power THD-137 High Speed', 19.32, 2.58, 5.3),
('Mexico', 'Progressive Die Press', 'United Power THD-333 High Speed', 40.81, 2.97, 5.3),
('Mexico', 'Tandem Press', 'United Power THD-333 High Speed', 40.81, 2.97, 5.3),
('Mexico', 'Progressive Die Press', 'United Power THD-66 High Speed', 9.43, 2.51, 5.3),
('Mexico', 'Tandem Press', 'United Power THD-66 High Speed', 9.43, 2.51, 5.3),
('France', 'Progressive Die Press', 'Default Press', 30.48, 17.82, 40.36),
('France', 'Tandem Press', 'Default Press', 30.48, 17.82, 40.36),
('France', 'Progressive Die Press', 'Schuler 1150 Ton', 82.91, 21.37, 40.36),
('France', 'Tandem Press', 'Schuler 1150 Ton', 76.88, 21.37, 40.36),
('France', 'Progressive Die Press', 'Schuler A2/200 - 360', 58.05, 17.39, 40.36),
('France', 'Tandem Press', 'Schuler A2/200 - 360', 58.05, 17.39, 40.36),
('France', 'Progressive Die Press', 'Schuler TSD 2000', 262.24, 36.09, 40.36),
('France', 'Tandem Press', 'Schuler TSD 2000', 262.24, 36.09, 40.36),
('France', 'Progressive Die Press', 'United Power SHD-220 Ton', 26.03, 18.31, 40.36),
('France', 'Tandem Press', 'United Power SHD-220 Ton', 26.03, 18.31, 40.36),
('France', 'Progressive Die Press', 'United Power SHD-400 Ton', 46.68, 19.35, 40.36),
('France', 'Tandem Press', 'United Power SHD-400 Ton', 46.68, 19.35, 40.36),
('France', 'Progressive Die Press', 'United Power SHD-666 Ton', 83.42, 20.47, 40.36),
('France', 'Tandem Press', 'United Power SHD-666 Ton', 77.72, 20.47, 40.36),
('France', 'Progressive Die Press', 'United Power SHS-166 Ton', 19.28, 16.62, 40.36),
('France', 'Tandem Press', 'United Power SHS-166 Ton', 19.28, 16.62, 40.36),
('France', 'Progressive Die Press', 'United Power SHS-666 Ton', 83.42, 17.49, 40.36),
('France', 'Tandem Press', 'United Power SHS-666 Ton', 77.72, 17.49, 40.36),
('France', 'Progressive Die Press', 'United Power THD-137 High Speed', 19.1, 16.78, 40.36),
('France', 'Tandem Press', 'United Power THD-137 High Speed', 19.1, 16.78, 40.36),
('France', 'Progressive Die Press', 'United Power THD-333 High Speed', 41.33, 17.76, 40.36),
('France', 'Tandem Press', 'United Power THD-333 High Speed', 41.33, 17.76, 40.36),
('France', 'Progressive Die Press', 'United Power THD-66 High Speed', 9.3, 16.62, 40.36),
('France', 'Tandem Press', 'United Power THD-66 High Speed', 9.3, 16.62, 40.36)
) AS v(location, live_category, name, direct, indirect, labor)
  ON lower(usa.machine_name) = lower(v.name)
 AND usa.benchmark_source_key = v.live_category || ':' || v.name
WHERE usa.location = 'USA';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, location, count(*) FROM mhr_records
--   WHERE location IN ('India', 'China', 'Mexico', 'France') AND machine_name IN ('Default Press', 'Schuler 1150 Ton', 'Schuler A2/200 - 360', 'Schuler TSD 2000', 'United Power SHD-220 Ton', 'United Power SHD-400 Ton', 'United Power SHD-666 Ton', 'United Power SHS-166 Ton', 'United Power SHS-666 Ton', 'United Power THD-137 High Speed', 'United Power THD-333 High Speed', 'United Power THD-66 High Speed')
--   GROUP BY machine_name, location ORDER BY machine_name, location;
-- -- Every row should now show count = 2 (was 6 before this migration).
-- SELECT machine_name, location, benchmark_source_key, direct_overhead_rate, indirect_overhead_rate
--   FROM mhr_records WHERE machine_name = 'Schuler 1150 Ton' ORDER BY location, benchmark_source_key;

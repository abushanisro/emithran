-- ============================================================================
-- Migration 596: Fix 3 Plasma Punch machines migration 594 silently dropped
-- due to spelling/formatting variants (2026-08-28)
--
-- 'Ermak CPP 1270 X 30' / 'Muratec Magnum - 5000 Plasma' (China/India/
-- Mexico/France) and 'Plasma Punch - 100 Watts 300kN' (India/Mexico/France
-- only -- China's own file already had the exact live-matching name) never
-- exact-matched the live catalog's 'Ermak COP 1270 X 30' / 'Muratec
-- Magnium - 5000 Plasma' / 'Plasma Punch - 100 Watts, 300kN Press Force',
-- so migration 594's join produced zero rows for them -- not wrong data,
-- just silently missing. This migration adds the correct rows using the
-- verified alias mapping (spelling/punctuation variants of the same real
-- machine, not different specs -- see the generator script's header for the
-- 4 OTHER Plasma Punch mismatches that were deliberately NOT aliased here
-- because they are genuinely different model numbers/specs, not typos).
--
-- Same clone-from-live-USA-row pattern as migrations 594/595. Dedup via
-- NOT EXISTS -- safe to re-run.
-- ============================================================================

BEGIN;

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
('India', 'Ermak COP 1270 X 30', 17.57, 2.81, 2.22),
('India', 'Muratec Magnium - 5000 Plasma', 36.79, 4.66, 2.22),
('India', 'Plasma Punch - 100 Watts, 300kN Press Force', 18.06, 2.81, 2.22),
('China', 'Ermak COP 1270 X 30', 16.32, 6, 10.43),
('China', 'Muratec Magnium - 5000 Plasma', 34.19, 7.45, 10.43),
('Mexico', 'Ermak COP 1270 X 30', 23.77, 3.72, 5.3),
('Mexico', 'Muratec Magnium - 5000 Plasma', 49.7, 4.94, 5.3),
('Mexico', 'Plasma Punch - 100 Watts, 300kN Press Force', 24.6, 3.72, 5.3),
('France', 'Ermak COP 1270 X 30', 23.5, 19.65, 40.36),
('France', 'Muratec Magnium - 5000 Plasma', 49.19, 22.69, 40.36),
('France', 'Plasma Punch - 100 Watts, 300kN Press Force', 24.21, 19.65, 40.36)
) AS v(location, name, direct, indirect, labor)
  ON lower(usa.machine_name) = lower(v.name)
WHERE usa.location = 'USA'
AND NOT EXISTS (
  SELECT 1 FROM mhr_records mr2
  WHERE lower(mr2.machine_name) = lower(usa.machine_name) AND mr2.location = v.location
);

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, location FROM mhr_records
--   WHERE machine_name IN ('Ermak COP 1270 X 30', 'Muratec Magnium - 5000 Plasma', 'Plasma Punch - 100 Watts, 300kN Press Force')
--   ORDER BY machine_name, location;
-- -- Each machine_name should now show USA + India + China + Mexico + France (5 rows) --
-- -- except 'Plasma Punch - 100 Watts, 300kN Press Force', which China already had via 594, so re-verify it doesn't duplicate (NOT EXISTS should have skipped it).

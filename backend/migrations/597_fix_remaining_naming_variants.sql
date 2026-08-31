-- ============================================================================
-- Migration 597: Fix remaining naming-variant gaps across India/China/
-- Mexico/France machine rates (2026-08-28, root-cause pass)
--
-- After migrations 594/595/596, 38 machine names per location remained
-- unresolved (verified identical across India/Mexico/France; China had its
-- own separate small set from migration 596). Checked every one against the
-- REAL live 'location=USA' catalog (via direct query, not inference) and
-- China's own file (using the CORRECT China category labels -- e.g. India's
-- "Shear" category = China's "Shearing Machine", "CO2 Laser Cutter" =
-- China's "Laser Cutting Machine" -- an earlier attempt used wrong labels
-- and produced false "no match" results, corrected before writing this).
--
-- Of the 38: 30 are verified spelling/punctuation/formatting variants of a
-- real live machine (same model number, same physical spec -- see the
-- generator script's ALIAS map for the exact reasoning per name: OCR-style
-- single-character confusions, missing thousands-separator commas, dropped
-- suffix words like "Thickness"/"Tool"). One additional case ('2 Roll
-- Bender - 200mm...') was confirmed via a screenshot of the original source
-- tool to be the live catalog's OWN transcription artifact (extra zero),
-- not an India/China/Mexico/France error -- aliased for rate-matching
-- purposes only, the live row's own dimension fields are untouched.
--
-- The remaining 8 (4 from this pass + 4 already documented in migration
-- 596's Plasma Punch analysis) are genuinely different specs -- different
-- model numbers or wattage/press-force values the live catalog has no
-- variant of at all -- and are deliberately left unaliased. See the
-- generator script's header for the itemized list. These are real,
-- confirmed data gaps, not something this migration guesses at.
--
-- Same clone-from-live-USA-row + NOT EXISTS dedup pattern as migrations
-- 594/595/596. Safe to re-run.
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
('India', '2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter', 1.69, 1.2, 2.95),
('India', '2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter', 2.46, 1.27, 2.95),
('India', 'Knuth KRM-5 30/4', 4.27, 1.63, 2.95),
('India', 'Cut To Length Line - 12mm Max Steel, 21mm Max Aluminum Thickness', 13.37, 15.04, 2.12),
('India', 'Cut To Length Line - 6mm Max Steel, 12mm Max Aluminum Thickness', 13.37, 15.04, 2.12),
('India', 'FO-MII 2412 NT', 19.66, 2.12, 2.22),
('India', 'FO-MII 3015 NT', 29.33, 2.94, 2.22),
('India', 'FO-MII RI 3015', 29.28, 3.65, 2.22),
('India', 'Trumpf True Laser 5030 - Truflow 10kW', 61.59, 4.16, 2.22),
('India', 'Trumpf True Laser 5030 - Truflow 8kW', 53.02, 4.16, 2.22),
('India', 'LVD Strippit 1250 MXP/30 LaserTool', 37.55, 2.62, 2.22),
('India', 'Plasma Cutter - 1000 Watts, 4 Heads', 6.09, 5.2, 2.22),
('India', 'Plasma Cutter - 400 Watts, 1 Head', 5.61, 5.2, 2.22),
('India', 'Progressive Die Press - 1,500kN Press Force', 13.42, 1.81, 2.22),
('India', 'Progressive Die Press - 10,000kN Press Force', 86.73, 7.86, 2.22),
('India', 'Progressive Die Press - 3,000kN Press Force', 29.22, 2.14, 2.22),
('India', 'Progressive Die Press - 5,000kN Press Force', 48.32, 2.51, 2.22),
('India', 'Progressive Die Press - 7,000kN Press Force', 64.43, 4.44, 2.22),
('India', 'Shear - 13mm Steel, 20mm Aluminum Max Thickness', 8.11, 2.04, 2.22),
('India', 'Shear - 3.5mm Steel, 5mm Aluminum Max Thickness', 3.18, 1.85, 2.22),
('India', 'Shear - 7mm Steel, 10mm Aluminum Max Thickness', 4.66, 2.04, 2.22),
('India', 'Standard Press - 1,500kN Press Force', 13.42, 1.81, 2.22),
('India', 'Standard Press - 3,000kN Press Force', 29.22, 2.14, 2.22),
('India', 'Standard Press - 5,000kN Press Force', 48.32, 2.51, 2.22),
('India', 'Standard Press - 7,000kN Press Force', 64.43, 4.44, 2.22),
('India', 'Tandem Press - 1,500kN Press Force', 13.42, 1.81, 2.22),
('India', 'Tandem Press - 3,000kN Press Force', 29.22, 2.14, 2.22),
('India', 'Tandem Press - 5,000kN Press Force', 48.32, 2.51, 2.22),
('India', 'Tandem Press - 7,000kN Press Force', 64.43, 4.44, 2.22),
('India', 'Turret Press - 4.5mm Steel, 6mm Aluminum Max Thickness', 12.18, 2.45, 2.22),
('India', 'Turret Press - 6mm Steel, 8mm Aluminum Max Thickness', 13.88, 3.91, 2.22),
('India', 'Turret Press - 8mm Steel, 10mm Aluminum Max Thickness', 27.96, 5.91, 2.22),
('China', '2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter', 1.58, 4.09, 12.42),
('China', '2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter', 2.29, 4.17, 12.42),
('Mexico', '2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter', 2.12, 2.12, 6.3),
('Mexico', '2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter', 3.18, 2.18, 6.3),
('Mexico', 'Knuth KRM-5 30/4', 5.62, 2.54, 6.3),
('Mexico', 'Cut To Length Line - 12mm Max Steel, 21mm Max Aluminum Thickness', 16.84, 16, 4.37),
('Mexico', 'Cut To Length Line - 6mm Max Steel, 12mm Max Aluminum Thickness', 16.84, 16, 4.37),
('Mexico', 'FO-MII 2412 NT', 26.39, 3.03, 5.3),
('Mexico', 'FO-MII 3015 NT', 39.11, 3.86, 5.3),
('Mexico', 'FO-MII RI 3015', 39.05, 4.57, 5.3),
('Mexico', 'Trumpf True Laser 5030 - Truflow 10kW', 83.1, 5.08, 5.3),
('Mexico', 'Trumpf True Laser 5030 - Truflow 8kW', 70.65, 5.08, 5.3),
('Mexico', 'LVD Strippit 1250 MXP/30 LaserTool', 49.01, 3.54, 5.3),
('Mexico', 'Plasma Cutter - 1000 Watts, 4 Heads', 8.05, 6.12, 5.3),
('Mexico', 'Plasma Cutter - 400 Watts, 1 Head', 7.47, 6.12, 5.3),
('Mexico', 'Progressive Die Press - 1,500kN Press Force', 18.3, 2.72, 5.3),
('Mexico', 'Progressive Die Press - 10,000kN Press Force', 113.51, 8.79, 5.3),
('Mexico', 'Progressive Die Press - 3,000kN Press Force', 38.07, 3.06, 5.3),
('Mexico', 'Progressive Die Press - 5,000kN Press Force', 62.86, 3.43, 5.3),
('Mexico', 'Progressive Die Press - 7,000kN Press Force', 83.36, 5.36, 5.3),
('Mexico', 'Shear - 13mm Steel, 20mm Aluminum Max Thickness', 12.59, 2.95, 5.3),
('Mexico', 'Shear - 3.5mm Steel, 5mm Aluminum Max Thickness', 4.54, 2.76, 5.3),
('Mexico', 'Shear - 7mm Steel, 10mm Aluminum Max Thickness', 7.03, 2.95, 5.3),
('Mexico', 'Standard Press - 1,500kN Press Force', 18.3, 2.72, 5.3),
('Mexico', 'Standard Press - 3,000kN Press Force', 38.07, 3.06, 5.3),
('Mexico', 'Standard Press - 5,000kN Press Force', 62.86, 3.43, 5.3),
('Mexico', 'Standard Press - 7,000kN Press Force', 83.36, 5.36, 5.3),
('Mexico', 'Tandem Press - 1,500kN Press Force', 18.3, 2.72, 5.3),
('Mexico', 'Tandem Press - 3,000kN Press Force', 38.07, 3.06, 5.3),
('Mexico', 'Tandem Press - 5,000kN Press Force', 62.86, 3.43, 5.3),
('Mexico', 'Tandem Press - 7,000kN Press Force', 83.36, 5.36, 5.3),
('Mexico', 'Turret Press - 4.5mm Steel, 6mm Aluminum Max Thickness', 16.11, 3.37, 5.3),
('Mexico', 'Turret Press - 6mm Steel, 8mm Aluminum Max Thickness', 18.16, 4.83, 5.3),
('Mexico', 'Turret Press - 8mm Steel, 10mm Aluminum Max Thickness', 35.15, 6.84, 5.3),
('France', '2 Roll Bender - 2000mm Roll Length x 125mm Roll Diameter', 2.21, 15.62, 48.04),
('France', '2 Roll Bender - 8000mm Roll Length x 200mm Roll Diameter', 3.24, 15.78, 48.04),
('France', 'Knuth KRM-5 30/4', 5.67, 16.7, 48.04),
('France', 'Cut To Length Line - 12mm Max Steel, 21mm Max Aluminum Thickness', 17.5, 50.42, 33.29),
('France', 'Cut To Length Line - 6mm Max Steel, 12mm Max Aluminum Thickness', 17.5, 50.42, 33.29),
('France', 'FO-MII 2412 NT', 26.23, 17.92, 40.36),
('France', 'FO-MII 3015 NT', 39.06, 19.99, 40.36),
('France', 'FO-MII RI 3015', 39, 21.77, 40.36),
('France', 'Trumpf True Laser 5030 - Truflow 10kW', 82.33, 23.05, 40.36),
('France', 'Trumpf True Laser 5030 - Truflow 8kW', 70.6, 23.05, 40.36),
('France', 'LVD Strippit 1250 MXP/30 LaserTool', 49.68, 19.18, 40.36),
('France', 'Plasma Cutter - 1000 Watts, 4 Heads', 8.09, 25.66, 40.36),
('France', 'Plasma Cutter - 400 Watts, 1 Head', 7.47, 25.66, 40.36),
('France', 'Progressive Die Press - 1,500kN Press Force', 18, 17.14, 40.36),
('France', 'Progressive Die Press - 10,000kN Press Force', 117.05, 32.35, 40.36),
('France', 'Progressive Die Press - 3,000kN Press Force', 38.64, 17.99, 40.36),
('France', 'Progressive Die Press - 5,000kN Press Force', 65.11, 18.91, 40.36),
('France', 'Progressive Die Press - 7,000kN Press Force', 86.71, 23.76, 40.36),
('France', 'Shear - 13mm Steel, 20mm Aluminum Max Thickness', 11.35, 17.71, 40.36),
('France', 'Shear - 3.5mm Steel, 5mm Aluminum Max Thickness', 4.33, 17.25, 40.36),
('France', 'Shear - 7mm Steel, 10mm Aluminum Max Thickness', 6.46, 17.71, 40.36),
('France', 'Standard Press - 1,500kN Press Force', 18, 17.14, 40.36),
('France', 'Standard Press - 3,000kN Press Force', 38.64, 17.99, 40.36),
('France', 'Standard Press - 5,000kN Press Force', 65.11, 18.91, 40.36),
('France', 'Standard Press - 7,000kN Press Force', 86.71, 23.76, 40.36),
('France', 'Tandem Press - 1,500kN Press Force', 18, 17.14, 40.36),
('France', 'Tandem Press - 3,000kN Press Force', 38.64, 17.99, 40.36),
('France', 'Tandem Press - 5,000kN Press Force', 65.11, 18.91, 40.36),
('France', 'Tandem Press - 7,000kN Press Force', 86.71, 23.76, 40.36),
('France', 'Turret Press - 4.5mm Steel, 6mm Aluminum Max Thickness', 16.18, 18.76, 40.36),
('France', 'Turret Press - 6mm Steel, 8mm Aluminum Max Thickness', 18.38, 22.42, 40.36),
('France', 'Turret Press - 8mm Steel, 10mm Aluminum Max Thickness', 36.58, 27.45, 40.36)
) AS v(location, name, direct, indirect, labor)
  ON lower(usa.machine_name) = lower(v.name)
WHERE usa.location = 'USA'
AND NOT EXISTS (
  SELECT 1 FROM mhr_records mr2
  WHERE lower(mr2.machine_name) = lower(usa.machine_name) AND mr2.location = v.location
);

COMMIT;

-- Verification (run manually after):
-- SELECT location, count(*) FROM mhr_records WHERE location IN ('India','China','Mexico','France') GROUP BY location ORDER BY location;
-- -- Should increase from the post-596 baseline (289/310/276/276) by however many of the 31 aliases matched per location.
-- SELECT machine_name, location FROM mhr_records
--   WHERE machine_name IN ('Knuth KRM-5 30/4', 'FO-MII 2412 NT', 'Progressive Die Press - 1,500kN Press Force', 'Standard Press - 1,500kN Press Force', 'Tandem Press - 1,500kN Press Force')
--   ORDER BY machine_name, location;

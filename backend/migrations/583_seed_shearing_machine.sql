-- ============================================================================
-- Migration 583: Seed "Shearing Machine" -- a real, previously-missing
-- machine_library.json category (10 machines, shop-provided fleet data)
--
-- Context: unlike migrations 582 (2 Roll Bender / Plasma Cutting Machine,
-- drawn from the same "World Average" benchmark dataset as the original 281
-- machines), this batch's own source is "Provided screenshots" of a real
-- shop's shear fleet -- a distinct provenance, not the benchmark dataset.
-- Kept honestly distinct: source_region = 'Shop Fleet' (not 'World Average'
-- or 'USA', matching neither existing convention because this genuinely
-- isn't either dataset), data_source = 'Provided screenshots' (not "the
-- system Baseline", which would misattribute the source).
--
-- Source shape was a nested object per machine (accounting/time/rates/
-- limits/other/yields/machine_economics/manufacturer_information) --
-- flattened to this file's established flat convention before staging
-- (labor_rate_usd_per_hr -> labor_rate_usd_hr, labor_time_standard_hr ->
-- labor_time_standard, good_yield -> good_part_yield, supplies_cost_usd_per_yr
-- -> supplies_cost_usd_yr, matching every other category). shear_speed (a
-- genuinely new, category-specific field, likely strokes/min given its 11-35
-- range but not asserted) kept as a bare field, no unit fabricated.
-- wage_grade_name is null on all 10 machines in the source -- left null, not
-- backfilled by migration 577's category-level heuristic (that heuristic was
-- only ever a fallback for rows the source itself never provided a real
-- value for; this category IS a real per-machine value, it's just null).
--
-- Taxonomy linking -- DELIBERATE DEVIATION from migration 569's own pattern,
-- explained:
--   A live query (2026-08-27) found process_calculator_mappings already has
--   an active 'Shearing' operation (Sheet Cutting route) -- but its
--   machine_class is 'press_brake', a REAL, LIVE MACHINE_REGISTRY key
--   (default-rates.ts), unlike 'roll_forming'/'plasma' (migration 582),
--   which aren't in that registry and so were harmlessly inert once applied.
--   Mirroring that machine_class here would make these 10 dedicated shears
--   enter the SAME live selection pool press_brake bending operations draw
--   from (machine-selection/selector.ts's Tier 0 check) -- a shear is a
--   physically different machine from a press brake (straight-line cutting
--   vs. bending) with no real bending capability, so a bend-operation quote
--   could silently select a shear's price/overhead for a job it can't
--   actually perform. That is a real correctness regression, not a safe
--   taxonomy tag, so machine_class is deliberately left NULL here (a
--   documented gap) while process_route/operation are still populated for
--   real, honest reporting. 'Shearing' (not the also-active but misspelled
--   'Shearning') is used as the operation name, matching migration 569's own
--   precedent of preferring a correctly-spelled active row when one exists.
-- ============================================================================

BEGIN;

-- Step 1: Stage into sm_reference_data
INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Chicago - HS 25130', '66300', 'Currency', 'Shearing Machine reference spec', '{"name": "Chicago - HS 25130", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 10.46, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 11, "max_thickness_aluminum_mm": 19, "max_thickness_brass_mm": 17.8, "max_thickness_copper_mm": 19, "max_thickness_stainless_steel_mm": 11.4, "max_thickness_steel_mm": 12.7, "shear_length_mm": 3100, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 66300, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 42.63, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Chicago HS 3195', '60500', 'Currency', 'Shearing Machine reference spec', '{"name": "Chicago HS 3195", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 7.69, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 13, "max_thickness_aluminum_mm": 14, "max_thickness_brass_mm": 13.3, "max_thickness_copper_mm": 14, "max_thickness_stainless_steel_mm": 8.6, "max_thickness_steel_mm": 9.5, "shear_length_mm": 3099, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 60500, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 26.64, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Default Shear', '40000', 'Currency', 'Shearing Machine reference spec', '{"name": "Default Shear", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 3.93, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 30, "max_thickness_aluminum_mm": 19, "max_thickness_brass_mm": 17.8, "max_thickness_copper_mm": 19, "max_thickness_stainless_steel_mm": 11.4, "max_thickness_steel_mm": 12.7, "shear_length_mm": 3099, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 40000, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 10, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Nisshinbo LGS-C 8', '27000', 'Currency', 'Shearing Machine reference spec', '{"name": "Nisshinbo LGS-C 8", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 3.15, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 25, "max_thickness_aluminum_mm": 9, "max_thickness_brass_mm": 8.4, "max_thickness_copper_mm": 9, "max_thickness_stainless_steel_mm": 5.4, "max_thickness_steel_mm": 6, "shear_length_mm": 2500, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 27000, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 10, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Japan", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Roper Whitney - 10H8', '40700', 'Currency', 'Shearing Machine reference spec', '{"name": "Roper Whitney - 10H8", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 4.07, "indirect_overhead_rate_usd_hr": 15.74, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 32, "max_thickness_aluminum_mm": 5.1, "max_thickness_brass_mm": 4.8, "max_thickness_copper_mm": 5.1, "max_thickness_stainless_steel_mm": 3.1, "max_thickness_steel_mm": 3.4, "shear_length_mm": 2438, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 40700, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 10.66, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Roper Whitney - 10M14', '22260', 'Currency', 'Shearing Machine reference spec', '{"name": "Roper Whitney - 10M14", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 2.15, "indirect_overhead_rate_usd_hr": 15.74, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 35, "max_thickness_aluminum_mm": 2.8, "max_thickness_brass_mm": 2.7, "max_thickness_copper_mm": 2.8, "max_thickness_stainless_steel_mm": 1.7, "max_thickness_steel_mm": 1.9, "shear_length_mm": 3080, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 22260, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 5.33, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "USA", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Salvagnini S4Xe.30', '30000', 'Currency', 'Shearing Machine reference spec', '{"name": "Salvagnini S4Xe.30", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 3.33, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 32, "max_thickness_aluminum_mm": 5.08, "max_thickness_brass_mm": 4.8, "max_thickness_copper_mm": 5.08, "max_thickness_stainless_steel_mm": 2.03, "max_thickness_steel_mm": 3.56, "shear_length_mm": 3048, "trim_strip_width_mm": 0.0, "is_preferred": false, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 30000, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 10, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Italy", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Shear - 13mm Steel, 20mm Aluminum Max Thickness', '65000', 'Currency', 'Shearing Machine reference spec', '{"name": "Shear - 13mm Steel, 20mm Aluminum Max Thickness", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 9.98, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 12, "max_thickness_aluminum_mm": 20, "max_thickness_brass_mm": 18, "max_thickness_copper_mm": 20, "max_thickness_stainless_steel_mm": 11.7, "max_thickness_steel_mm": 13, "shear_length_mm": 3000, "trim_strip_width_mm": 0.0, "is_preferred": true, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 65000, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 40, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Shear - 3.5mm Steel, 5mm Aluminum Max Thickness', '40000', 'Currency', 'Shearing Machine reference spec', '{"name": "Shear - 3.5mm Steel, 5mm Aluminum Max Thickness", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 3.93, "indirect_overhead_rate_usd_hr": 15.74, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 35, "max_thickness_aluminum_mm": 5, "max_thickness_brass_mm": 4.7, "max_thickness_copper_mm": 5, "max_thickness_stainless_steel_mm": 3.2, "max_thickness_steel_mm": 3.5, "shear_length_mm": 3000, "trim_strip_width_mm": 0.0, "is_preferred": true, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 40000, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 10, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Shearing Machine:Shear - 7mm Steel, 10mm Aluminum Max Thickness', '45000', 'Currency', 'Shearing Machine reference spec', '{"name": "Shear - 7mm Steel, 10mm Aluminum Max Thickness", "labor_rate_usd_hr": 36.3, "direct_overhead_rate_usd_hr": 5.75, "indirect_overhead_rate_usd_hr": 16.22, "overhead_multiplier": 0.0, "number_of_operators": 1.0, "labor_time_standard": 1.25, "wage_grade_name": null, "work_center_labor_rate_factor": 1.0, "setup_time_hr": 0.38, "shear_speed": 25, "max_thickness_aluminum_mm": 10, "max_thickness_brass_mm": 9.2, "max_thickness_copper_mm": 10, "max_thickness_stainless_steel_mm": 6.4, "max_thickness_steel_mm": 7, "shear_length_mm": 3000, "trim_strip_width_mm": 0.0, "is_preferred": true, "avg_utilization": 0.8, "good_part_yield": 1.0, "machine_price_usd": 45000, "machine_length_mm": 3048.0, "machine_width_mm": 1524.0, "footprint_allowance_factor": 6.0, "machine_power_kw": 20, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_yr": 0.0, "machine_manufacturer_location": "Virtual", "data_source": "Provided screenshots", "machine_category": "Shearing Machine"}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;


-- Step 2: Promote into mhr_records (migration 564's exact query, scoped to this new category)
DO $$
DECLARE
  matched_count      INTEGER;
BEGIN
  WITH name_counts AS (
    SELECT lower(raw->>'name') AS name_lower, COUNT(*) AS cnt
    FROM sm_reference_data
    WHERE category = 'machine'
    GROUP BY lower(raw->>'name')
  ),
  unambiguous AS (
    SELECT sr.key, sr.raw
    FROM sm_reference_data sr
    JOIN name_counts c ON c.name_lower = lower(sr.raw->>'name')
    WHERE sr.category = 'machine' AND c.cnt = 1
  ),
  to_promote AS (
    SELECT u.key, u.raw
    FROM unambiguous u
    WHERE NOT EXISTS (
      SELECT 1 FROM mhr_records mr WHERE lower(mr.machine_name) = lower(u.raw->>'name')
    )
    AND u.key LIKE 'Shearing Machine:%'
  )
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
    NULL, NULL,
    'USA', 'Sheet Metal', 'Sheet Metal', NULL,
    tp.raw->>'name',
    tp.raw->>'description',
    tp.raw->>'machine_manufacturer_location',
    NULLIF(tp.raw->>'machine_price_usd', '')::numeric,
    GREATEST(COALESCE(NULLIF(tp.raw->>'machine_price_usd', '')::numeric, 1), 1),
    true,
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2),
    3, 8, 260, 0,
    95, 6, 20, 10, 8, 1, 0, 0, 6, 0, 0, 0, 0,
    NULLIF(tp.raw->>'machine_power_kw', '')::numeric,
    'USD', '$',
    NULLIF(tp.raw->>'direct_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'labor_rate_usd_hr', '')::numeric,
    'benchmark', 'benchmark', 'benchmark',
    1, NOW(),
    'benchmark', tp.key,
    NULLIF(tp.raw->>'direct_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr', '')::numeric,
    NULLIF(tp.raw->>'labor_rate_usd_hr', '')::numeric
  FROM to_promote tp;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RAISE NOTICE 'Migration 583: promoted % new mhr_records row(s) for Shearing Machine.', matched_count;
END $$;

-- Step 3: Link process taxonomy identity only (machine_class deliberately
-- left NULL -- see header). Matches migration 572's "identity only" naming
-- for this exact situation (a real route/operation with no safe machine_class
-- to assign).
UPDATE mhr_records SET process_route = 'Sheet Cutting', operation = 'Shearing'
WHERE benchmark_source_key LIKE 'Shearing Machine:%' AND process_route IS NULL;

-- Step 4: Backfill Tier-1 universal economics fields (migration 573's exact UPDATE)
UPDATE mhr_records m
SET
  labor_time_standard = COALESCE(m.labor_time_standard, (srd.raw->>'labor_time_standard')::numeric),
  avg_utilization = COALESCE(m.avg_utilization, (srd.raw->>'avg_utilization')::numeric),
  good_part_yield = COALESCE(m.good_part_yield, (srd.raw->>'good_part_yield')::numeric),
  machine_length_mm = COALESCE(m.machine_length_mm, (srd.raw->>'machine_length_mm')::numeric),
  machine_width_mm = COALESCE(m.machine_width_mm, (srd.raw->>'machine_width_mm')::numeric),
  machine_life_yr = COALESCE(m.machine_life_yr, (srd.raw->>'machine_life_yr')::numeric),
  machine_power_kw = COALESCE(m.machine_power_kw, (srd.raw->>'machine_power_kw')::numeric),
  machine_uptime_pct = COALESCE(m.machine_uptime_pct, (srd.raw->>'machine_uptime_pct')::numeric),
  annual_maintenance_factor_pct = COALESCE(m.annual_maintenance_factor_pct, (srd.raw->>'annual_maintenance_factor_pct')::numeric),
  footprint_allowance_factor = COALESCE(m.footprint_allowance_factor, (srd.raw->>'footprint_allowance_factor')::numeric),
  installation_factor_pct = COALESCE(m.installation_factor_pct, (srd.raw->>'installation_factor_pct')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Shearing Machine:%';

-- Salvage value / supplies-cost-per-year (migration 574 columns, feed Step 6's
-- formula below) -- same JOIN backfill approach.
UPDATE mhr_records m
SET
  salvage_value_factor_pct = COALESCE(m.salvage_value_factor_pct, (srd.raw->>'salvage_value_factor_pct')::numeric),
  supplies_cost_per_year = COALESCE(m.supplies_cost_per_year, (srd.raw->>'supplies_cost_usd_yr')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Shearing Machine:%';

-- Step 5: Backfill wage_grade/operators/setup_time_hr from real source data
-- (wage_grade stays NULL here -- the source's own wage_grade_name is null
-- for all 10 machines; NULLIF/COALESCE below fall through to NULL correctly,
-- not fabricated).
UPDATE mhr_records m
SET
  wage_grade = COALESCE(m.wage_grade, NULLIF(srd.raw->>'wage_grade_name', '')),
  operators = COALESCE(m.operators, (srd.raw->>'number_of_operators')::numeric),
  setup_time_hr = COALESCE(m.setup_time_hr, (srd.raw->>'setup_time_hr')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Shearing Machine:%';

-- Step 6: Backfill calculated_mhr_usd_hr / mhr_source (migration 580's exact UPDATE)
UPDATE mhr_records
SET
  legacy_imported_mhr_usd_hr = manual_mhr_value,
  calculated_mhr_usd_hr = ROUND(
    (
      machine_price_usd * (1 - CASE WHEN salvage_value_factor_pct > 1 THEN salvage_value_factor_pct / 100 ELSE salvage_value_factor_pct END) / machine_life_yr
      + machine_price_usd * CASE WHEN annual_maintenance_factor_pct > 1 THEN annual_maintenance_factor_pct / 100 ELSE annual_maintenance_factor_pct END
      + machine_price_usd * CASE WHEN installation_factor_pct > 1 THEN installation_factor_pct / 100 ELSE installation_factor_pct END / machine_life_yr
      + COALESCE(supplies_cost_per_year, 0)
    )
    /
    (
      6240 * CASE WHEN machine_uptime_pct > 1 THEN machine_uptime_pct / 100 ELSE machine_uptime_pct END * avg_utilization
    ),
    4
  ),
  mhr_source = 'calculated'
WHERE benchmark_source_key IS NOT NULL
  AND calculated_mhr_usd_hr IS NULL
  AND machine_price_usd IS NOT NULL AND machine_price_usd > 0
  AND machine_life_yr IS NOT NULL AND machine_life_yr > 0
  AND salvage_value_factor_pct IS NOT NULL
  AND annual_maintenance_factor_pct IS NOT NULL
  AND installation_factor_pct IS NOT NULL
  AND machine_uptime_pct IS NOT NULL AND machine_uptime_pct > 0
  AND avg_utilization IS NOT NULL AND avg_utilization > 0
  AND benchmark_source_key LIKE 'Shearing Machine:%';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, machine_class, process_route, operation, direct_overhead_rate,
--        indirect_overhead_rate, total_machine_hour_rate, calculated_mhr_usd_hr, wage_grade, operators
--   FROM mhr_records WHERE benchmark_source_key LIKE 'Shearing Machine:%' ORDER BY machine_name;
-- SELECT count(*) FROM sm_reference_data WHERE category='machine' AND key LIKE 'Shearing Machine:%';

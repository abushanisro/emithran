-- ============================================================================
-- Migration 584: Seed "Plasma Punch" -- a real, previously-missing
-- machine_library.json category (12 machines, combination CNC punch +
-- plasma-cutting machines: Whitney/Strippit, Muratec, Ficep, Ermak)
--
-- Context: source is user-provided screenshots of a photographed
-- spreadsheet -- the source's own note says "visually ambiguous fields
-- should be verified against the original spreadsheet before production
-- import." Flattened to this file's established convention
-- (labor_rate_usd_per_hr -> labor_rate_usd_hr, annual_maintenance_pct ->
-- annual_maintenance_factor_pct, machine_life_years -> machine_life_yr).
--
-- REAL, NOTABLE GAP vs. every prior category (2 Roll Bender/Plasma Cutting/
-- Shearing, migrations 582-583): this source has NO
-- direct_overhead_rate_usd_hr / indirect_overhead_rate_usd_hr at all, no
-- wage_grade_name, no number_of_operators, no machine_manufacturer_location.
-- Per the canonical-MHR decision (migration 581, MHR = Direct OH + Indirect
-- OH, never fabricated), total_machine_hour_rate/manual_mhr_value are left
-- NULL for these 12 rows -- not a fabricated $0 for real $270K-$965K
-- machines. The promotion query below is adjusted from migration 564's
-- original (which always COALESCEs a missing side to 0, silently producing
-- 0 when BOTH sides are absent) to preserve NULL specifically when neither
-- overhead figure exists on either side; it still sums normally the moment
-- real Direct/Indirect data is sourced and either side is present, exactly
-- matching every other category's existing behavior.
--
-- calculated_mhr_usd_hr (migration 580, reference-only bottom-up estimate)
-- CAN still be computed for these rows since every capex/lifecycle input it
-- needs (price, life, salvage, maintenance, installation, uptime,
-- utilization) IS present -- so these rows aren't left with zero usable rate
-- information, just no canonical MHR yet.
--
-- Taxonomy linking -- identity only, matching migration 572's own precedent:
-- process_calculator_mappings already has a real 'Plasma Punch' operation
-- (Sheet Metal Fabrication route) but it is_active=false with machine_class
-- NULL (confirmed live, 2026-08-27) -- no cost engine backs it yet (same
-- "Plasma, Oxyfuel (no cost engine yet)" CLAUDE.md gap). process_route/
-- operation are populated for real, honest reporting; machine_class is
-- deliberately left NULL, same discipline as migration 572's 2-Axis Router/
-- Oxyfuel/Tandem Press rows.
-- ============================================================================

BEGIN;

-- Step 1: Stage into sm_reference_data
INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Whitney 4400 Max', '268521.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Whitney 4400 Max", "labor_rate_usd_hr": 36.3, "setup_time_hr": 0.5, "power_watts": 200.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 268521.0, "machine_length_mm": 2500.0, "machine_width_mm": 4000.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Whitney 3700 SST', '725000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Whitney 3700 SST", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 260.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 725000.0, "machine_length_mm": 7185.0, "machine_width_mm": 4500.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 90.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Whitney 3400 XP', '797000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Whitney 3400 XP", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.3, "power_watts": 200.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 797000.0, "machine_length_mm": 7185.0, "machine_width_mm": 4500.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Whitney 3400 Heavy', '365000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Whitney 3400 Heavy", "labor_rate_usd_hr": 36.3, "setup_time_hr": 0.5, "power_watts": 300.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 365000.0, "machine_length_mm": 1585.0, "machine_width_mm": 3207.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Plasma Punch - 400 Watts, 1000kN Press Force', '270000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Plasma Punch - 400 Watts, 1000kN Press Force", "labor_rate_usd_hr": 36.3, "setup_time_hr": 0.5, "power_watts": 400.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 270000.0, "machine_length_mm": 4250.0, "machine_width_mm": 4000.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Plasma Punch - 200 Watts, 350kN Press Force', '360000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Plasma Punch - 200 Watts, 350kN Press Force", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 300.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 360000.0, "machine_length_mm": 5000.0, "machine_width_mm": 5200.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Plasma Punch - 200 Watts, 550kN Press Force', '750000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Plasma Punch - 200 Watts, 550kN Press Force", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 200.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 750000.0, "machine_length_mm": 6500.0, "machine_width_mm": 4500.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Plasma Punch - 100 Watts, 300kN Press Force', '900000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Plasma Punch - 100 Watts, 300kN Press Force", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 100.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 900000.0, "machine_length_mm": 7185.0, "machine_width_mm": 5000.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Muratec Magnium - 5000 Plasma', '790000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Muratec Magnium - 5000 Plasma", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 200.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 790000.0, "machine_length_mm": 7620.0, "machine_width_mm": 4500.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Ficep Tipo C23', '752000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Ficep Tipo C23", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 400.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 752000.0, "machine_length_mm": 7620.0, "machine_width_mm": 4672.0, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Ficep Tipo C23 (second unit)', '720000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Ficep Tipo C23 (second unit)", "labor_rate_usd_hr": 30.3, "setup_time_hr": 0.5, "power_watts": 300.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 720000.0, "machine_length_mm": 3048.0, "machine_width_mm": 2438.4, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb),
('machine', 'Shop Fleet', '2026-08', 'Plasma Punch:Ermak COP 1270 X 30', '965000.0', 'Currency', 'Plasma Punch reference spec', '{"name": "Ermak COP 1270 X 30", "labor_rate_usd_hr": 36.3, "setup_time_hr": 0.5, "power_watts": 100.0, "avg_utilization": 0.85, "good_part_yield": 1.0, "machine_price_usd": 965000.0, "machine_length_mm": 3048.0, "machine_width_mm": 2438.4, "footprint_allowance_factor": 3.0, "installation_factor_pct": 20.0, "machine_uptime_pct": 80.0, "annual_maintenance_factor_pct": 5.0, "machine_life_yr": 10, "salvage_value_factor_pct": 0.0, "supplies_cost_usd_per_hr": 0.0, "data_source": "User-provided screenshots", "machine_category": "Plasma Punch"}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;


-- Step 2: Promote into mhr_records. Same dedup query as migration 564, with
-- one deliberate change: total_machine_hour_rate/manual_mhr_value are NULL
-- (not a fabricated 0) when NEITHER direct nor indirect overhead is present
-- on the source row -- see header. Every other expression is unchanged.
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
    AND u.key LIKE 'Plasma Punch:%'
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
    CASE
      WHEN NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','') IS NULL
       AND NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','') IS NULL
      THEN NULL
      ELSE ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2)
    END,
    CASE
      WHEN NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','') IS NULL
       AND NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','') IS NULL
      THEN NULL
      ELSE ROUND(COALESCE(NULLIF(tp.raw->>'direct_overhead_rate_usd_hr','')::numeric,0) + COALESCE(NULLIF(tp.raw->>'indirect_overhead_rate_usd_hr','')::numeric,0), 2)
    END,
    NULL, -- fully_burdened_local_per_hr: depends on total_machine_hour_rate + LHR, neither real here
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
  RAISE NOTICE 'Migration 584: promoted % new mhr_records row(s) for Plasma Punch.', matched_count;
END $$;

-- Step 3: Link process taxonomy identity only (machine_class deliberately
-- left NULL -- see header; matches migration 572's precedent exactly).
UPDATE mhr_records SET process_route = 'Sheet Metal Fabrication', operation = 'Plasma Punch'
WHERE benchmark_source_key LIKE 'Plasma Punch:%' AND process_route IS NULL;

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
  AND srd.key LIKE 'Plasma Punch:%';

-- Salvage value / supplies-cost-per-year (migration 574 columns, feed Step 6's
-- formula below). supplies_cost_usd_per_hr in the source is 0.0 for all 12
-- rows regardless of its unit label (see header) -- safe to map either way.
UPDATE mhr_records m
SET
  salvage_value_factor_pct = COALESCE(m.salvage_value_factor_pct, (srd.raw->>'salvage_value_factor_pct')::numeric),
  supplies_cost_per_year = COALESCE(m.supplies_cost_per_year, (srd.raw->>'supplies_cost_usd_per_hr')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Plasma Punch:%';

-- Step 5: wage_grade/operators/setup_time_hr -- wage_grade and operators stay
-- NULL (genuinely absent in the source, not fabricated); setup_time_hr IS
-- present and backfilled.
UPDATE mhr_records m
SET
  wage_grade = COALESCE(m.wage_grade, NULLIF(srd.raw->>'wage_grade_name', '')),
  operators = COALESCE(m.operators, (srd.raw->>'number_of_operators')::numeric),
  setup_time_hr = COALESCE(m.setup_time_hr, (srd.raw->>'setup_time_hr')::numeric)
FROM sm_reference_data srd
WHERE srd.key = m.benchmark_source_key
  AND srd.category = 'machine'
  AND srd.key LIKE 'Plasma Punch:%';

-- Step 6: Backfill calculated_mhr_usd_hr / mhr_source (migration 580's exact
-- UPDATE) -- computable here even though total_machine_hour_rate is NULL,
-- since this formula never reads Direct/Indirect OH.
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
  AND benchmark_source_key LIKE 'Plasma Punch:%';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, machine_class, process_route, operation, direct_overhead_rate,
--        indirect_overhead_rate, total_machine_hour_rate, calculated_mhr_usd_hr, wage_grade, operators
--   FROM mhr_records WHERE benchmark_source_key LIKE 'Plasma Punch:%' ORDER BY machine_name;
-- SELECT count(*) FROM sm_reference_data WHERE category='machine' AND key LIKE 'Plasma Punch:%';

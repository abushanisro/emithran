-- ============================================================================
-- Migration 598: China rate corrections + OMAX 80160 promotion (2026-08-28)
--
-- Context: a fresh, independently re-verified screenshot read of the China
-- Digital Factory Manager tool was compared against china_location_data_full
-- .json (used throughout migrations 594-597) and against the LIVE
-- 'location=USA' mhr_records catalog (queried directly, not inferred). The
-- three sources disagreed on several machine NAMES in the "Progressive Die
-- Press" category (Aida vs Amada, SMX-0-L2 vs SMX-II-L2 vs SMX-H-12, SHD
-- vs 9HD, 666 vs 665, TSD vs T50, B-35 vs B-55) -- but the underlying RATE
-- NUMBERS matched almost exactly across old file and new screenshot for
-- every row, strong evidence these are the same real machines with just
-- name-transcription noise, not different machines.
--
-- Resolution: the live catalog's own naming never changed and is confirmed
-- via direct query to still use the OLD convention (Aida/SHD/SHS/TSD/B-35/
-- 666 Ton) -- china_location_data_full.json's names were reverted to match
-- live exactly (that file is just a JOIN-key source for this pipeline; the
-- live catalog is the actual identity authority). The re-verified
-- screenshot's NUMBERS, where they differ from the old file, ARE kept as
-- more accurate -- naming and rate-value accuracy are separate questions.
--
-- This migration:
--   Step 1: corrects 5 already-promoted CHINA-location mhr_records rows'
--           indirect_overhead_rate (and the derived MHR fields) to the
--           re-verified values. Confirmed via the same screenshot: direct
--           rates and every other value were unchanged for these rows --
--           only indirect_overhead_rate needed correcting.
--   Step 2: promotes 'OMAX 80160' for China/India/Mexico/France -- this
--           machine was missing from china_location_data_full.json
--           entirely (never attempted in migrations 594-597), but is
--           confirmed to already exist live under 'Waterjet Cutting
--           Machine:OMAX 80160'. India/Mexico/France's own source files
--           already had real rate data for this machine, just never
--           promotable before because the join had nothing to resolve
--           China's name against.
--
-- NOT included here (needs separate verification before touching): the
-- "ESAB Hydrocut" -> "ESAB HybriCut" name correction and the "14000mm" ->
-- "1400mm" waterjet bed-size digit correction -- both applied to the
-- reference file already, but neither has been checked against the live
-- catalog's actual naming the way the Progressive Die Press machines were.
-- Given the Progressive Die Press case just showed 3 sources can each
-- differ, these should not be trusted without the same direct-query check.
-- ============================================================================

BEGIN;

-- ── Step 1: correct the 5 indirect-rate values for already-promoted China rows ──
UPDATE mhr_records
SET indirect_overhead_rate = 4.51,
    manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 4.51, 2),
    total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 4.51, 2),
    fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 4.51, 2),
    benchmark_indirect_overhead_rate_usd_hr = 4.51
WHERE location = 'China' AND machine_name = 'Aida UMX-600';

UPDATE mhr_records
SET indirect_overhead_rate = 4.51,
    manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 4.51, 2),
    total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 4.51, 2),
    fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 4.51, 2),
    benchmark_indirect_overhead_rate_usd_hr = 4.51
WHERE location = 'China' AND machine_name = 'Aida UMX-800';

UPDATE mhr_records
SET indirect_overhead_rate = 5.27,
    manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 5.27, 2),
    total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 5.27, 2),
    fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 5.27, 2),
    benchmark_indirect_overhead_rate_usd_hr = 5.27
WHERE location = 'China' AND machine_name = 'Progressive Die Press - 3,000kN Press Force';

UPDATE mhr_records
SET indirect_overhead_rate = 6.90,
    manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 6.90, 2),
    total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 6.90, 2),
    fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 6.90, 2),
    benchmark_indirect_overhead_rate_usd_hr = 6.90
WHERE location = 'China' AND machine_name = 'United Power SHD-666 Ton';

UPDATE mhr_records
SET indirect_overhead_rate = 4.36,
    manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 4.36, 2),
    total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 4.36, 2),
    fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 4.36, 2),
    benchmark_indirect_overhead_rate_usd_hr = 4.36
WHERE location = 'China' AND machine_name = 'United Power SHS-166 Ton';

-- ── Step 2: promote 'OMAX 80160' for China/India/Mexico/France ────────────
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
  ('China', 12.45, 6.89, 10.43),
  ('India', 13.4, 3.1, 2.22),
  ('Mexico', 18.27, 4.02, 5.3),
  ('France', 17.97, 20.4, 40.36)
) AS v(location, direct, indirect, labor)
  ON lower(usa.machine_name) = lower('OMAX 80160')
WHERE usa.location = 'USA' AND lower(usa.machine_name) = lower('OMAX 80160')
AND NOT EXISTS (
  SELECT 1 FROM mhr_records mr2
  WHERE lower(mr2.machine_name) = lower('OMAX 80160') AND mr2.location = v.location
);

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, location, indirect_overhead_rate FROM mhr_records
--   WHERE machine_name IN ('Aida UMX-600', 'Aida UMX-800', 'Progressive Die Press - 3,000kN Press Force', 'United Power SHD-666 Ton', 'United Power SHS-166 Ton')
--   AND location = 'China' ORDER BY machine_name;
-- -- Expect indirect_overhead_rate = 4.51 / 4.51 / 5.27 / 6.90 / 4.36 respectively.
-- SELECT machine_name, location FROM mhr_records WHERE machine_name = 'OMAX 80160' ORDER BY location;
-- -- Expect USA + China + India + Mexico + France (5 rows).

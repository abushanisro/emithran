-- ============================================================================
-- Migration 586: Revert the 4 "Standard Press" tier rows' physical/capex
-- specs back to the original pairing (2026-08-27, user-confirmed tie-break)
--
-- Context: migration 585 promoted 4 new mhr_records rows ('Standard Press -
-- 1,500/3,000/5,000/7,000kN Press Force'). Their physical/capex block
-- (machine_price_usd, machine_length_mm, machine_width_mm, machine_power_kw)
-- was corrected in-place before that migration ran, based on a second
-- transcription (press_machine_staging.json) that disagreed with the
-- original (standard_press_machine_data.json). Migration 585 then ran live
-- with that "corrected" pairing.
--
-- A 4th transcription (std_press.json) subsequently surfaced, matching the
-- ORIGINAL pairing exactly -- tying the vote 2-2 (press_machine_staging.json
-- + stage_press.json agreed with the "corrected" pairing; standard_press_
-- machine_data.json + std_press.json agree with the ORIGINAL). Direct/
-- Indirect OH were identical across every transcription throughout and were
-- never in question -- only price/press-force/dimensions/power were ever in
-- dispute. User decided the tie in favor of the ORIGINAL pairing.
--
-- This migration reverts the 4 already-promoted mhr_records rows'
-- machine_price_usd/machine_length_mm/machine_width_mm/machine_power_kw to
-- the original values, and recomputes calculated_mhr_usd_hr (migration 580's
-- bottom-up formula depends on machine_price_usd, so it must be
-- recalculated -- it is NOT guarded by "IS NULL" this time since a value is
-- already present from the now-superseded price). total_machine_hour_rate/
-- manual_mhr_value are UNCHANGED -- canonical MHR (migration 581) is Direct
-- OH + Indirect OH only, and those never differed between pairings.
--
-- sm_reference_data's 'Standard Press:%' staged rows are also corrected to
-- match, for consistency between the staging and promoted tables (585.sql
-- itself was separately corrected back to the original values, so a fresh-DB
-- run of 505...585 would never hit this discrepancy at all -- this
-- migration exists only to fix the one DB where 585 already ran with the
-- superseded values). The separate 'Standard Press (staging)' audit copy of
-- press_machine_staging.json is deliberately left untouched -- it is a
-- faithful record of that one transcription, not a claim about which
-- pairing is correct.
-- ============================================================================

BEGIN;

-- Step 1: Revert mhr_records' physical/capex fields to the original pairing.
UPDATE mhr_records SET machine_price_usd = 318000, machine_length_mm = 3000.0, machine_width_mm = 3240.0, machine_power_kw = 57.88
WHERE benchmark_source_key = 'Standard Press:Standard Press - 1,500kN Press Force';

UPDATE mhr_records SET machine_price_usd = 350000, machine_length_mm = 3601.72, machine_width_mm = 3236.97, machine_power_kw = 22.37
WHERE benchmark_source_key = 'Standard Press:Standard Press - 3,000kN Press Force';

UPDATE mhr_records SET machine_price_usd = 500000, machine_length_mm = 3200.0, machine_width_mm = 3240.0, machine_power_kw = 40.0
WHERE benchmark_source_key = 'Standard Press:Standard Press - 5,000kN Press Force';

UPDATE mhr_records SET machine_price_usd = 529000, machine_length_mm = 3454.4, machine_width_mm = 2743.2, machine_power_kw = 44.74
WHERE benchmark_source_key = 'Standard Press:Standard Press - 7,000kN Press Force';

-- Step 2: Recompute calculated_mhr_usd_hr (migration 580's exact formula,
-- unguarded by "IS NULL" here since a stale value from the superseded price
-- is already present and must be overwritten, not skipped).
UPDATE mhr_records
SET
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
  )
WHERE benchmark_source_key IN (
  'Standard Press:Standard Press - 1,500kN Press Force',
  'Standard Press:Standard Press - 3,000kN Press Force',
  'Standard Press:Standard Press - 5,000kN Press Force',
  'Standard Press:Standard Press - 7,000kN Press Force'
)
AND machine_price_usd IS NOT NULL AND machine_price_usd > 0
AND machine_life_yr IS NOT NULL AND machine_life_yr > 0
AND salvage_value_factor_pct IS NOT NULL
AND annual_maintenance_factor_pct IS NOT NULL
AND installation_factor_pct IS NOT NULL
AND machine_uptime_pct IS NOT NULL AND machine_uptime_pct > 0
AND avg_utilization IS NOT NULL AND avg_utilization > 0;

-- Step 3: Correct the staged sm_reference_data rows to match (consistency
-- between staging and promoted tables; not read live by the app). Every
-- jsonb_set value argument is explicitly cast to jsonb -- relying on
-- unknown-literal coercion here is unnecessary risk in a migration that
-- writes live data.
UPDATE sm_reference_data
SET
  value = '318000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(raw, '{press_force_kn}', '1365.0'::jsonb),
              '{machine_price_usd}', '318000'::jsonb),
            '{machine_length_mm}', '3000.0'::jsonb),
          '{machine_width_mm}', '3240.0'::jsonb)
        || jsonb_build_object('machine_power_kw', 57.88::numeric)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 1,500kN Press Force';

UPDATE sm_reference_data
SET
  value = '350000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(raw, '{press_force_kn}', '5000.0'::jsonb),
              '{machine_price_usd}', '350000'::jsonb),
            '{machine_length_mm}', '3601.72'::jsonb),
          '{machine_width_mm}', '3236.97'::jsonb)
        || jsonb_build_object('machine_power_kw', 22.37::numeric)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 3,000kN Press Force';

UPDATE sm_reference_data
SET
  value = '500000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(raw, '{press_force_kn}', '2000.0'::jsonb),
              '{machine_price_usd}', '500000'::jsonb),
            '{machine_length_mm}', '3200.0'::jsonb),
          '{machine_width_mm}', '3240.0'::jsonb)
        || jsonb_build_object('machine_power_kw', 40.0::numeric)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 5,000kN Press Force';

UPDATE sm_reference_data
SET
  value = '529000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(raw, '{press_force_kn}', '3000.0'::jsonb),
              '{machine_price_usd}', '529000'::jsonb),
            '{machine_length_mm}', '3454.4'::jsonb),
          '{machine_width_mm}', '2743.2'::jsonb)
        || jsonb_build_object('machine_power_kw', 44.74::numeric)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 7,000kN Press Force';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, machine_price_usd, machine_length_mm, machine_width_mm, machine_power_kw,
--        total_machine_hour_rate, calculated_mhr_usd_hr
--   FROM mhr_records WHERE benchmark_source_key LIKE 'Standard Press:%' ORDER BY machine_name;
-- -- Expect: 1,500kN=$318,000 / 3000x3240mm / 57.88kW; 3,000kN=$350,000 / 3601.72x3236.97mm / 22.37kW;
-- --         5,000kN=$500,000 / 3200x3240mm / 40kW; 7,000kN=$529,000 / 3454.4x2743.2mm / 44.74kW.
-- -- total_machine_hour_rate unchanged (32.27 / 52.80 / 79.64 / 105.39) -- Direct+Indirect OH never changed.

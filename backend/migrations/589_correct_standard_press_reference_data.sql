-- ============================================================================
-- Migration 589: Correct "Standard Press" reference data against the real,
-- authoritative source (2026-08-27, principal-engineer reconciliation pass)
--
-- Context: earlier migrations (585, 586) reconciled 5 mutually-conflicting
-- "Standard Press batch" transcription files against EACH OTHER, but never
-- checked them against the actual pre-existing, authoritative Progressive
-- Die Press / Tandem Press data already live in mhr_records (imported months
-- earlier via migrations 564/569, untouched by any of this) -- which turns
-- out to be a genuinely different, more authoritative source for the 12
-- "duplicate" machines (Default Press, Schuler x3, United Power x8).
--
-- This migration corrects the STAGED sm_reference_data reference copy under
-- 'Standard Press:%' for those 12 machines (price, dimensions, power,
-- Direct/Indirect OH) to match the real, live Progressive Die Press /
-- Tandem Press values -- pulled directly from mhr_records, 2026-08-27. These
-- 12 machines are NEVER promoted into mhr_records (the by-name dedup in
-- migration 585 correctly skips them every time), so this is a pure
-- reference-accuracy correction with ZERO effect on live quote costing --
-- the real, live mhr_records rows for these 12 (under Progressive Die
-- Press/Tandem Press) are completely unaffected by this migration.
--
-- Also corrects press_force_kn on the 4 REAL, promoted tier rows ('Standard
-- Press - 1,500/3,000/5,000/7,000kN Press Force') to match each machine's
-- own name (1500/3000/5000/7000), backed by 2-of-3 independent transcription
-- lineages agreeing (correcting for press_machine_staging.json and
-- stage_press.json being near-duplicates of each other, not independent
-- evidence) and by simple name self-consistency. press_force_kn is not
-- stored on any mhr_records column (only migration 570's max_tonnage
-- backfill reads it, scoped to press_brake/turret_punch machine_class,
-- which these rows don't have) -- reference-only, zero live-costing effect.
-- Nothing else on the 4 promoted rows changes: price/dimensions/power/
-- Direct+Indirect OH/total_machine_hour_rate were already independently
-- confirmed correct by the same camp analysis and are left untouched.
--
-- Deliberately NOT addressed here: the live Progressive Die Press/Tandem
-- Press Direct/Indirect OH for Schuler 1150 Ton, Schuler A2/200-360, United
-- Power SHD-666 Ton, and United Power SHS-666 Ton disagree with what all 5
-- Standard-Press-batch files independently agree on (e.g. Schuler 1150 Ton:
-- live $79.56/$25.94 vs. batch consensus $72.61/$19.94). That is a
-- materially bigger, separate decision affecting already-live production
-- rows -- explicitly left for a dedicated review, not bundled in here.
-- ============================================================================

BEGIN;

UPDATE sm_reference_data
SET
  value = '318000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '318000'::jsonb),
                '{machine_length_mm}', '3000.0'::jsonb),
              '{machine_width_mm}', '3240.0'::jsonb),
            '{direct_overhead_rate_usd_hr}', '28.0'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '16.33'::jsonb)
        || jsonb_build_object('machine_power_kw', 57.88::numeric)
WHERE category = 'machine' AND key = 'Standard Press:Default Press';

UPDATE sm_reference_data
SET
  value = '1120000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '1120000'::jsonb),
                '{machine_length_mm}', '6807.2'::jsonb),
              '{machine_width_mm}', '3497.58'::jsonb),
            '{direct_overhead_rate_usd_hr}', '79.56'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '25.94'::jsonb)
        - 'machine_power_kw'
WHERE category = 'machine' AND key = 'Standard Press:Schuler 1150 Ton';

UPDATE sm_reference_data
SET
  value = '798000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '798000'::jsonb),
                '{machine_length_mm}', '2700.0'::jsonb),
              '{machine_width_mm}', '2970.0'::jsonb),
            '{direct_overhead_rate_usd_hr}', '55.83'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '18.89'::jsonb)
        - 'machine_power_kw'
WHERE category = 'machine' AND key = 'Standard Press:Schuler A2/200 - 360';

UPDATE sm_reference_data
SET
  value = '3600000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '3600000'::jsonb),
                '{machine_length_mm}', '12200.0'::jsonb),
              '{machine_width_mm}', '6750.0'::jsonb),
            '{direct_overhead_rate_usd_hr}', '248.15'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '34.96'::jsonb)
        || jsonb_build_object('machine_power_kw', 200.0::numeric)
WHERE category = 'machine' AND key = 'Standard Press:Schuler TSD 2000';

UPDATE sm_reference_data
SET
  value = '350000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '350000'::jsonb),
                '{machine_length_mm}', '3601.72'::jsonb),
              '{machine_width_mm}', '3236.97'::jsonb),
            '{direct_overhead_rate_usd_hr}', '24.57'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '16.82'::jsonb)
        || jsonb_build_object('machine_power_kw', 22.37::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power SHD-220 Ton';

UPDATE sm_reference_data
SET
  value = '636000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '636000'::jsonb),
                '{machine_length_mm}', '4508.88'::jsonb),
              '{machine_width_mm}', '3511.2'::jsonb),
            '{direct_overhead_rate_usd_hr}', '44.13'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '17.89'::jsonb)
        || jsonb_build_object('machine_power_kw', 37.29::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power SHD-400 Ton';

UPDATE sm_reference_data
SET
  value = '1060000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '1060000'::jsonb),
                '{machine_length_mm}', '4998.72'::jsonb),
              '{machine_width_mm}', '4053.08'::jsonb),
            '{direct_overhead_rate_usd_hr}', '79.41'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '19.03'::jsonb)
        || jsonb_build_object('machine_power_kw', 74.57::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power SHD-666 Ton';

UPDATE sm_reference_data
SET
  value = '264000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '264000'::jsonb),
                '{machine_length_mm}', '1757.5'::jsonb),
              '{machine_width_mm}', '2806.16'::jsonb),
            '{direct_overhead_rate_usd_hr}', '18.23'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '15.1'::jsonb)
        || jsonb_build_object('machine_power_kw', 14.91::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power SHS-166 Ton';

UPDATE sm_reference_data
SET
  value = '1060000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '1060000'::jsonb),
                '{machine_length_mm}', '3236.98'::jsonb),
              '{machine_width_mm}', '4053.08'::jsonb),
            '{direct_overhead_rate_usd_hr}', '79.41'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '15.99'::jsonb)
        || jsonb_build_object('machine_power_kw', 74.57::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power SHS-666 Ton';

UPDATE sm_reference_data
SET
  value = '218000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '218000'::jsonb),
                '{machine_length_mm}', '2286.4'::jsonb),
              '{machine_width_mm}', '2438.4'::jsonb),
            '{direct_overhead_rate_usd_hr}', '17.7'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '15.26'::jsonb)
        || jsonb_build_object('machine_power_kw', 29.81::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power THD-137 High Speed';

UPDATE sm_reference_data
SET
  value = '529000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '529000'::jsonb),
                '{machine_length_mm}', '3454.4'::jsonb),
              '{machine_width_mm}', '2743.2'::jsonb),
            '{direct_overhead_rate_usd_hr}', '38.78'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '16.26'::jsonb)
        || jsonb_build_object('machine_power_kw', 44.74::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power THD-333 High Speed';

UPDATE sm_reference_data
SET
  value = '105000',
  raw = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(raw, '{machine_price_usd}', '105000'::jsonb),
                '{machine_length_mm}', '1757.5'::jsonb),
              '{machine_width_mm}', '2804.16'::jsonb),
            '{direct_overhead_rate_usd_hr}', '8.61'::jsonb),
          '{indirect_overhead_rate_usd_hr}', '15.1'::jsonb)
        || jsonb_build_object('machine_power_kw', 14.91::numeric)
WHERE category = 'machine' AND key = 'Standard Press:United Power THD-66 High Speed';

UPDATE sm_reference_data
SET raw = jsonb_set(raw, '{press_force_kn}', '1500'::jsonb)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 1,500kN Press Force';

UPDATE sm_reference_data
SET raw = jsonb_set(raw, '{press_force_kn}', '3000'::jsonb)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 3,000kN Press Force';

UPDATE sm_reference_data
SET raw = jsonb_set(raw, '{press_force_kn}', '5000'::jsonb)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 5,000kN Press Force';

UPDATE sm_reference_data
SET raw = jsonb_set(raw, '{press_force_kn}', '7000'::jsonb)
WHERE category = 'machine' AND key = 'Standard Press:Standard Press - 7,000kN Press Force';

COMMIT;

-- Verification (run manually after):
-- SELECT key, value, raw->>'machine_price_usd', raw->>'direct_overhead_rate_usd_hr', raw->>'indirect_overhead_rate_usd_hr'
--   FROM sm_reference_data WHERE category='machine' AND key LIKE 'Standard Press:%' ORDER BY key;
-- -- mhr_records is untouched by this migration -- confirm nothing changed there:
-- SELECT machine_name, machine_price_usd, total_machine_hour_rate FROM mhr_records
--   WHERE benchmark_source_key LIKE 'Standard Press:%' ORDER BY machine_name;
-- -- Should be identical to before this migration ran (4 rows, same values as migration 586 left them).

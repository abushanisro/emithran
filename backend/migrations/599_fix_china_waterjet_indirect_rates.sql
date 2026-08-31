-- ============================================================================
-- Migration 599: Correct 9 China Waterjet indirect-overhead rates (2026-08-28)
--
-- Context: same audit pattern as migration 598's Progressive Die Press
-- corrections, extended to the Waterjet Cutting Machine category per user
-- request ("SURE I WANT 0 GAP"). A fresh, independently re-verified
-- screenshot read of the China Digital Factory Manager tool was compared
-- programmatically against china_location_data_full.json (used to seed
-- migration 594). Every DIRECT overhead rate matched exactly across all 20
-- Waterjet machines checked -- only 9 machines had an INDIRECT-rate
-- discrepancy (the same pattern seen in the 5 Progressive Die Press
-- corrections in migration 598 -- direct rates transcribed correctly,
-- indirect rates had isolated errors). No machine names differ in this
-- category (unlike Progressive Die Press) -- these are pure numeric
-- corrections to already-correctly-matched live China rows.
--
-- Corrected (old value -> new, verified) value:
--   Flow Mach 2 1313b:    4.98 -> 4.56
--   Flow Mach 2 4020b:    7.56 -> 7.23
--   Flow Mach 3 7320b:    9.93 -> 5.83
--   Flow Mach 4 40140c:  20.82 -> 20.12
--   Flow Mach 700 50240: 31.80 -> 31.89
--   Maxiem 1530:          5.08 -> 5.62
--   Maxiem 2040:          5.90 -> 5.80
--   OMAX 2626:            4.71 -> 4.77
--   OMAX 55100:           4.92 -> 4.86
--
-- Checked and confirmed already correct (no change needed): ESAB Hydrocut
-- LX 6500, the 14000mm x 4000mm bed-size row, Flow Mach 3 1313b, Flow Mach
-- 300 3020, Flow Mach 4 2020c, Flow Mach 500 4080, KMT SL-V 100 PLUS/E-50,
-- KMT STREAMLINE PRO 125HP, Maxiem 0707, OMAX 2652/60120.
-- ============================================================================

BEGIN;

UPDATE mhr_records SET indirect_overhead_rate = 4.56,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 4.56, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 4.56, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 4.56, 2),
  benchmark_indirect_overhead_rate_usd_hr = 4.56
WHERE location = 'China' AND machine_name = 'Flow Mach 2 1313b';

UPDATE mhr_records SET indirect_overhead_rate = 7.23,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 7.23, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 7.23, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 7.23, 2),
  benchmark_indirect_overhead_rate_usd_hr = 7.23
WHERE location = 'China' AND machine_name = 'Flow Mach 2 4020b';

UPDATE mhr_records SET indirect_overhead_rate = 5.83,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 5.83, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 5.83, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 5.83, 2),
  benchmark_indirect_overhead_rate_usd_hr = 5.83
WHERE location = 'China' AND machine_name = 'Flow Mach 3 7320b';

UPDATE mhr_records SET indirect_overhead_rate = 20.12,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 20.12, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 20.12, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 20.12, 2),
  benchmark_indirect_overhead_rate_usd_hr = 20.12
WHERE location = 'China' AND machine_name = 'Flow Mach 4 40140c';

UPDATE mhr_records SET indirect_overhead_rate = 31.89,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 31.89, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 31.89, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 31.89, 2),
  benchmark_indirect_overhead_rate_usd_hr = 31.89
WHERE location = 'China' AND machine_name = 'Flow Mach 700 50240';

UPDATE mhr_records SET indirect_overhead_rate = 5.62,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 5.62, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 5.62, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 5.62, 2),
  benchmark_indirect_overhead_rate_usd_hr = 5.62
WHERE location = 'China' AND machine_name = 'Maxiem 1530';

UPDATE mhr_records SET indirect_overhead_rate = 5.80,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 5.80, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 5.80, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 5.80, 2),
  benchmark_indirect_overhead_rate_usd_hr = 5.80
WHERE location = 'China' AND machine_name = 'Maxiem 2040';

UPDATE mhr_records SET indirect_overhead_rate = 4.77,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 4.77, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 4.77, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 4.77, 2),
  benchmark_indirect_overhead_rate_usd_hr = 4.77
WHERE location = 'China' AND machine_name = 'OMAX 2626';

UPDATE mhr_records SET indirect_overhead_rate = 4.86,
  manual_mhr_value = ROUND(COALESCE(direct_overhead_rate,0) + 4.86, 2),
  total_machine_hour_rate = ROUND(COALESCE(direct_overhead_rate,0) + 4.86, 2),
  fully_burdened_local_per_hr = ROUND(COALESCE(direct_overhead_rate,0) + 4.86, 2),
  benchmark_indirect_overhead_rate_usd_hr = 4.86
WHERE location = 'China' AND machine_name = 'OMAX 55100';

COMMIT;

-- Verification (run manually after):
-- SELECT machine_name, indirect_overhead_rate FROM mhr_records
--   WHERE location = 'China' AND machine_name IN (
--     'Flow Mach 2 1313b','Flow Mach 2 4020b','Flow Mach 3 7320b','Flow Mach 4 40140c',
--     'Flow Mach 700 50240','Maxiem 1530','Maxiem 2040','OMAX 2626','OMAX 55100'
--   ) ORDER BY machine_name;
-- -- Expect: 4.56 / 7.23 / 5.83 / 20.12 / 31.89 / 5.62 / 5.80 / 4.77 / 4.86

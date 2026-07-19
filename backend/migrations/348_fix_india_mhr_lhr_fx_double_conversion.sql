-- Migration 348: Fix India MHR/LHR records inflated by USD→INR double-conversion
--
-- Root cause:
--   The "Combined_All_Countries" Excel import format is USD-denominated. When the
--   import processed rows with location = 'India', it multiplied the MHR/LHR value
--   by the USD→INR exchange rate (≈83.5). If the source Excel already had INR rates
--   (e.g. ₹1,138/hr for a fiber laser), the stored rate became ₹1,138 × 83.5 = ₹95,023/hr
--   — about 79× the correct India benchmark of ₹1,200/hr.
--
-- Pattern (all affected rows share this ratio):
--   fully_burdened_local_per_hr ≈ correct_inr_rate × 83.5
--   lhr ≈ correct_inr_lhr × 83.5
--
-- Fix:
--   Divide the stored values by 83.5 to reverse the inflation.
--   Threshold: only correct records that are > 3× the India class benchmark
--   (same threshold used by benchmarkRateWarning() in the application layer).
--   BENCHMARK rows are never touched (they were seeded by migrations, not imported).
--
-- Safe to re-run: the WHERE clause only matches values above the threshold; after the
--   first run the values will be in range and the UPDATE will match 0 rows.

-- ── MHR records ───────────────────────────────────────────────────────────────
-- India class benchmarks (from LOCATION_MHR_DEFAULTS in default-rates.ts):
--   fiber_laser  1200 INR/hr  → 3× threshold = 3600
--   press_brake   600 INR/hr  → 3× threshold = 1800
--   deburring     300 INR/hr  → 3× threshold =  900
--   tapping       400 INR/hr  → 3× threshold = 1200
--   cmm           450 INR/hr  → 3× threshold = 1350
--   cnc_3ax_vmc   900 INR/hr  → 3× threshold = 2700
-- Use a single conservative threshold of 2000 INR/hr to cover all sheet-metal classes.
-- (Legitimate India MHR records can legitimately reach ₹6,200/hr for 5-axis, so
--  we only fix records in the sheet-metal band where the benchmark is ≤1200.)

UPDATE mhr_records
SET
  fully_burdened_local_per_hr = CASE
    WHEN fully_burdened_local_per_hr IS NOT NULL AND fully_burdened_local_per_hr > 0
      THEN ROUND((fully_burdened_local_per_hr / 83.5)::numeric, 2)
    ELSE fully_burdened_local_per_hr
  END,
  total_machine_hour_rate = CASE
    WHEN total_machine_hour_rate IS NOT NULL AND total_machine_hour_rate > 0
      THEN ROUND((total_machine_hour_rate / 83.5)::numeric, 2)
    ELSE total_machine_hour_rate
  END,
  manual_mhr_value = CASE
    WHEN manual_mhr_value IS NOT NULL AND manual_mhr_value > 0
      THEN ROUND((manual_mhr_value / 83.5)::numeric, 2)
    ELSE manual_mhr_value
  END
WHERE
  location = 'India'
  AND (source_type IS NULL OR source_type NOT IN ('BENCHMARK'))
  -- Only correct sheet-metal-class records (benchmark ≤ 1200; threshold = 3600).
  -- CNC and injection molding classes have higher legitimate rates (₹2200–6200) so
  -- we use a tighter match: only fix when the commodity code is a known sheet-metal code.
  AND (
    commodity_code ILIKE '%LASER%'
    OR commodity_code ILIKE '%BRAKE%'
    OR commodity_code ILIKE '%DEBURR%'
    OR commodity_code ILIKE '%PUNCH%'
    OR commodity_code ILIKE '%WATERJET%'
    OR commodity_code ILIKE '%TAP%'
    OR process_group ILIKE '%Sheet Metal%'
    OR process_group ILIKE '%Laser%'
    OR process_group ILIKE '%Deburr%'
    OR process_group ILIKE '%Bending%'
  )
  AND (
    (fully_burdened_local_per_hr IS NOT NULL AND fully_burdened_local_per_hr > 3600)
    OR (total_machine_hour_rate IS NOT NULL AND total_machine_hour_rate > 3600)
    OR (manual_mhr_value IS NOT NULL AND manual_mhr_value > 3600)
  );

-- ── LHR records ───────────────────────────────────────────────────────────────
-- Legitimate India LHR range: ₹95–₹800/hr (unskilled → highly skilled, from migration 183).
-- Inflated values (₹95 × 83.5 = ₹7,932) are well above ₹2,400 (3× skilled rate of ₹800).
-- Use ₹2,400 as the threshold — anything above is a double-conversion artifact.

UPDATE lhr_records
SET
  lhr = ROUND((lhr / 83.5)::numeric, 2)
WHERE
  location = 'India'
  AND (source_type IS NULL OR source_type NOT IN ('BENCHMARK'))
  AND lhr > 2400;

-- ============================================================================
-- Migration 575: Fix unscaled bottom-up MHR factors on the 2-Axis Router batch
-- Purpose: 9 mhr_records rows (all "2-Axis Router" category machines, all
--          inserted in the same batch at 2026-08-23T01:39:17.819132+00:00)
--          were loaded directly from memory/sheetmetal/machine/machine_library.csv
--          without the x100 rescale every other category's rows received.
--          The CSV stores machine_uptime_pct / annual_maintenance_factor_pct /
--          installation_factor_pct as raw 0-1 fractions (e.g. 0.8, 0.05, 0.2);
--          every other row in mhr_records stores these same three columns on
--          a 0-100 scale (e.g. 80, 5, 20) -- confirmed live: of 281 rows with
--          avg_utilization set, only these 9 have machine_uptime_pct <= 1.
--          avg_utilization itself is NOT affected -- that column is 0-1
--          everywhere in the table, including these 9 rows, and needs no fix.
--
--          Left uncorrected, the bottom-up MHR formula (migration 574) divides
--          these already-fractional values by 100 again, understating this
--          batch's productive hours/maintenance/installation cost by ~100x.
--
--          Verified against the CSV before writing this migration -- these 9
--          machine names' CSV rows all read exactly 0.8 / 0.05 / 0.2, matching
--          the live (wrong-scale) DB values 1:1, confirming a raw copy-in
--          rather than a data-entry typo.
-- Author: Principal Engineering Team
-- Date: 2026-08-26
-- Version: 1.0.0
-- ============================================================================

UPDATE mhr_records
SET
  machine_uptime_pct = machine_uptime_pct * 100,
  annual_maintenance_factor_pct = annual_maintenance_factor_pct * 100,
  installation_factor_pct = installation_factor_pct * 100
WHERE id IN (
  '2fb90656-efa1-4fc5-940c-8a98e4eea42c', -- 2 Axis Router - 18,000 RPM
  'f417af5c-59c4-420d-bb4a-3095f589e2fc', -- 2 Axis Router - 20,000 RPM
  '702ebc06-98cc-47e2-b81c-61b508968715', -- 2 Axis Router - 24,000 RPM
  '7938c4f0-1ab5-41c5-8ecf-e7a54becd3a1', -- Multicam 103
  'c0f1f114-bc0d-4246-aa49-54ab21a65c6e', -- Multicam 204
  '9496cea6-d59d-4268-a4b3-b4f984ad69a0', -- Multicam 304
  'e5318562-6973-49fa-b3e2-da29bdc80a64', -- Stratos Pro
  '15ba5ae1-d989-4d6e-8571-e12d79cefaa4', -- Stratos Pro 24
  '343ec9af-da77-4ad0-915c-4c69fd464be2'  -- Stratos Pro XL
)
-- Belt-and-suspenders: only touch rows still in the known-bad state, so
-- re-running this migration is a no-op rather than a second x100.
AND machine_uptime_pct <= 1;

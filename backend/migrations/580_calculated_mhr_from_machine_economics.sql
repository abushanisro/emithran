-- ============================================================================
-- Migration 580: Calculated MHR from real machine economics, with provenance
--
-- Context: audited live (2026-08-27) — all 281 machine_library-imported
-- mhr_records rows have manual_mhr_value = direct_overhead_rate +
-- indirect_overhead_rate (is_manual_entry = true), a mechanical import
-- artifact from migration 564, NOT a genuine machine-hour rate — documented
-- in that migration's own header as a deliberate stopgap to avoid running
-- the old capex engine with fabricated rent/electricity/admin/profit inputs.
-- machine_library.json/mhr_records already carry real machine economics
-- (machine_price_usd, machine_life_yr, salvage_value_factor_pct,
-- installation_factor_pct, annual_maintenance_factor_pct, machine_uptime_pct,
-- avg_utilization, supplies_cost_per_year) that were never used to derive
-- MHR. This migration computes a genuine bottom-up MHR from those fields,
-- alongside — not replacing — the existing values.
--
-- Formula (approved 2026-08-27, see conversation record):
--   normalize(v) = v > 1 ? v / 100 : v
--   annual_depreciation = machine_price_usd * (1 - normalize(salvage_value_factor_pct)) / machine_life_yr
--   annual_maintenance  = machine_price_usd * normalize(annual_maintenance_factor_pct)
--   annual_installation = machine_price_usd * normalize(installation_factor_pct) / machine_life_yr
--   annual_supplies     = supplies_cost_per_year (COALESCE'd to 0 — confirmed
--                         live: 0/NULL for all 281 rows today, a real gap,
--                         not fabricated data; the column exists for when
--                         real figures arrive)
--   annual_machine_cost = depreciation + maintenance + installation + supplies
--   scheduled_hours_per_year = 6240  -- the project's OWN existing constant
--                         (MHR_CALCULATION_CONSTANTS.DEFAULTS: 3 shifts/day x
--                         8 hours/shift x 260 working days/year), not an
--                         invented calendar-hours (8760) assumption
--   practical_hours_per_year = scheduled_hours_per_year * normalize(machine_uptime_pct) * avg_utilization
--   calculated_mhr_usd_hr = annual_machine_cost / practical_hours_per_year
--
-- Deliberately excludes electricity (no validated $/kWh anywhere in this
-- dataset) and excludes direct_overhead_rate/indirect_overhead_rate/LHR
-- entirely — MHR must stay independent of overhead and labor.
--
-- Verified live (2026-08-27) before writing this: all 281 benchmarked rows
-- have machine_price_usd > 0, machine_life_yr > 0 (all = 10), and non-null
-- installation_factor_pct/annual_maintenance_factor_pct/machine_uptime_pct/
-- avg_utilization — so the WHERE guard below excludes nothing today, but is
-- kept as a real safety condition rather than assuming future rows will
-- always have complete data. Rows failing the guard get
-- calculated_mhr_usd_hr = NULL (an honest gap), never a fabricated 0.
--
-- Safety (explicit, per approval): does NOT modify total_machine_hour_rate,
-- manual_mhr_value, or is_manual_entry — machine-selection/selector.ts's
-- pickRate() keeps reading exactly what it always has; this migration has
-- zero effect on live quote costing. Switching costing over to
-- calculated_mhr_usd_hr is an explicitly separate, not-yet-approved decision.
--
-- Provenance: new mhr_source column distinguishes 'calculated' (this
-- migration's output is authoritative for the row), 'manual' (a human
-- deliberately entered/approved manual_mhr_value — none exist yet, confirmed
-- live: zero mhr_records rows were ever created through the app's own form),
-- and 'legacy_import' (the DEFAULT — covers the 13 unrelated original seed
-- rows from 2026-07-13, which have no machine_price_usd at all and so get no
-- calculated_mhr_usd_hr either). legacy_imported_mhr_usd_hr snapshots each
-- promoted row's pre-migration manual_mhr_value permanently, so the old
-- Direct+Indirect-derived figure remains inspectable even though it's no
-- longer this row's only number.
--
-- Idempotent: the UPDATE only touches rows where calculated_mhr_usd_hr IS
-- STILL NULL, so re-running finds nothing left to do on a second pass.
-- ============================================================================

BEGIN;

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS calculated_mhr_usd_hr      NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS legacy_imported_mhr_usd_hr NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS mhr_source                 TEXT NOT NULL DEFAULT 'legacy_import';

ALTER TABLE mhr_records
  DROP CONSTRAINT IF EXISTS mhr_records_mhr_source_check;
ALTER TABLE mhr_records
  ADD CONSTRAINT mhr_records_mhr_source_check CHECK (mhr_source IN ('calculated', 'manual', 'legacy_import'));

COMMENT ON COLUMN mhr_records.calculated_mhr_usd_hr IS
  'Bottom-up machine-hour rate computed from real machine economics (price, life, salvage, maintenance, installation, supplies, uptime, utilization) — independent of direct/indirect overhead and LHR. NULL when required inputs are missing, never fabricated. Reference/validation only until costing is explicitly switched over (not done by this migration).';
COMMENT ON COLUMN mhr_records.legacy_imported_mhr_usd_hr IS
  'Permanent snapshot of manual_mhr_value as it stood before this migration, for the 281 rows where that value was actually direct_overhead_rate + indirect_overhead_rate (migration 564''s import stopgap), not a genuine machine-hour rate. Preserved for audit even if manual_mhr_value later changes.';
COMMENT ON COLUMN mhr_records.mhr_source IS
  'Provenance of this row''s authoritative MHR figure: ''calculated'' (calculated_mhr_usd_hr, from real machine economics), ''manual'' (a human deliberately entered/approved manual_mhr_value — none exist yet), or ''legacy_import'' (default; an old import artifact, either the Direct+Indirect stopgap or the unrelated 2026-07-13 seed batch — not to be read as an approved value).';

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
  AND avg_utilization IS NOT NULL AND avg_utilization > 0;

COMMIT;

-- ── Verification (run manually after) ───────────────────────────────────────
-- SELECT mhr_source, COUNT(*) FROM mhr_records GROUP BY mhr_source;
-- SELECT machine_name, direct_overhead_rate, indirect_overhead_rate,
--        legacy_imported_mhr_usd_hr, calculated_mhr_usd_hr, total_machine_hour_rate, manual_mhr_value
-- FROM mhr_records WHERE benchmark_source_key LIKE '2-Axis Router:%' ORDER BY machine_name;

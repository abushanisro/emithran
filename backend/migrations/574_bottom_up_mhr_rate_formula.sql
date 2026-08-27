-- ============================================================================
-- Migration 574: Bottom-up MHR rate formula — new columns
-- Purpose: The HR Rates page/MHR engine is being redesigned around the same
--          bottom-up cost-accounting shape as the reference "machines" model
--          this session was given (depreciation + maintenance + supplies +
--          labor + overhead), replacing the old formula (depreciation +
--          interest + insurance + rent + maintenance + electricity + admin
--          overhead + profit margin). Product decision, explicit user choice
--          2026-08-26: replace the formula exactly, not extend the old one.
--
--          Most of the reference formula's inputs ALREADY exist on
--          mhr_records (migration 573 -- avg_utilization, machine_uptime_pct,
--          annual_maintenance_factor_pct, installation_factor_pct,
--          machine_life_yr -- were added as display-only benchmark metadata
--          and are now made load-bearing). This migration adds only the
--          genuinely missing columns:
--            supplies_cost_per_year      -- annual consumables/supplies cost
--                                            (local currency), reference's
--                                            supplies_cost_usd_yr.
--            salvage_value_factor_pct    -- end-of-life residual value, as a
--                                            0-100 percentage of machine
--                                            price (same convention as the
--                                            existing installation_factor_pct/
--                                            annual_maintenance_factor_pct
--                                            siblings, which are also 0-100
--                                            despite the reference's own
--                                            columns of the same name storing
--                                            raw 0-1 fractions -- MHRFormDialog's
--                                            existing max='100' on those two
--                                            fields is the authority here).
--            overhead_multiplier         -- multiplier applied to
--                                            direct+indirect overhead, default 1.
--            machine_labor_rate_per_hr   -- this machine's own operator wage
--                                            rate (local currency/hr), baked
--                                            into the machine's fully-burdened
--                                            rate. Deliberately a SEPARATE
--                                            column from usd_lhr_total/LHR
--                                            (lib/api/mhr.ts's resolveMhrUsdRate
--                                            already documents why: LHR/DLR is
--                                            a distinct labor concept read by
--                                            the live quote-costing engine's
--                                            own separate laborCost line —
--                                            baking that same number into MHR
--                                            too would double-count it).
--            work_center_labor_rate_factor -- multiplier on the labor line,
--                                            default 1.
--
--          total_machine_hour_rate stays MACHINE-ONLY (depreciation+
--          maintenance+supplies+overhead, no labor) so resolveMHRRates()/
--          cost-engine.ts's machineCost keeps reading exactly what it always
--          has -- zero change to live quote wiring. fully_burdened_local_per_hr
--          (existing column) becomes total_machine_hour_rate + the new labor
--          line, for the HR Rates page's headline display only, mirroring
--          resolveMhrUsdRate()'s existing machine-vs-burdened split.
-- Author: Principal Engineering Team
-- Date: 2026-08-26
-- Version: 1.0.0
-- ============================================================================

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS supplies_cost_per_year         NUMERIC(15, 2),
  ADD COLUMN IF NOT EXISTS salvage_value_factor_pct        NUMERIC(5, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overhead_multiplier             NUMERIC(6, 3) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS machine_labor_rate_per_hr       NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS work_center_labor_rate_factor   NUMERIC(6, 3) DEFAULT 1;

COMMENT ON COLUMN mhr_records.supplies_cost_per_year IS
  'Annual consumables/supplies cost (local currency) -- bottom-up MHR formula input. Reference: machines.supplies_cost_usd_yr.';
COMMENT ON COLUMN mhr_records.salvage_value_factor_pct IS
  'End-of-life residual value, as a 0-100 percentage of machine price -- reduces the depreciable base. 0-100 convention (not the reference''s raw 0-1 fraction) to match the existing installation_factor_pct/annual_maintenance_factor_pct sibling columns.';
COMMENT ON COLUMN mhr_records.overhead_multiplier IS
  'Multiplier applied to (direct_overhead_rate + indirect_overhead_rate) in the bottom-up MHR formula. Default 1 (no adjustment).';
COMMENT ON COLUMN mhr_records.machine_labor_rate_per_hr IS
  'This machine''s own operator wage rate (local currency/hr), baked into the fully-burdened rate shown on the HR Rates page. Distinct from usd_lhr_total (lhr_records/LHRService) -- that is the live quote-costing engine''s separate direct-labor line; never combine the two or labor is double-counted.';
COMMENT ON COLUMN mhr_records.work_center_labor_rate_factor IS
  'Multiplier on machine_labor_rate_per_hr x operators in the bottom-up MHR formula. Default 1 (no adjustment).';

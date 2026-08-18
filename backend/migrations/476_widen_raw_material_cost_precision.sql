-- ============================================================================
-- Migration: Widen raw_material_cost_records monetary column precision
-- Purpose: raw_material_cost_records.unit_cost and all derived cost columns
--          are now always resolved and stored in USD (see
--          raw-material-cost.service.ts create()/update(), which converts
--          the regional catalog price to USD via ExchangeRateService before
--          persisting). The columns were originally DECIMAL(15,4), sized for
--          INR-scale amounts (e.g. ₹222.5520). A cheap per-kg material in a
--          low-value-currency location (e.g. India, ~$0.0137/kg) produces
--          sub-cent derived costs (e.g. overhead_cost ~$0.000054) that get
--          silently rounded to 0.0000 at 4 decimal places on insert, even
--          when computed correctly upstream. Widening scale to 6 keeps these
--          representable. Paired with the PRECISION.COST/RATE constants bump
--          (3/4 -> 6) in raw-material-cost-calculation.constants.ts.
-- Author: Principal Engineering Team
-- Date: 2026-08-18
-- Version: 1.0.0
-- ============================================================================

ALTER TABLE raw_material_cost_records
  ALTER COLUMN unit_cost TYPE DECIMAL(18, 6),
  ALTER COLUMN reclaim_rate TYPE DECIMAL(18, 6),
  ALTER COLUMN total_cost TYPE DECIMAL(18, 6),
  ALTER COLUMN gross_material_cost TYPE DECIMAL(18, 6),
  ALTER COLUMN reclaim_value TYPE DECIMAL(18, 6),
  ALTER COLUMN net_material_cost TYPE DECIMAL(18, 6),
  ALTER COLUMN scrap_adjustment TYPE DECIMAL(18, 6),
  ALTER COLUMN overhead_cost TYPE DECIMAL(18, 6),
  ALTER COLUMN total_cost_per_unit TYPE DECIMAL(18, 6),
  ALTER COLUMN effective_cost_per_unit TYPE DECIMAL(18, 6);

COMMENT ON COLUMN raw_material_cost_records.unit_cost IS 'Resolved unit cost in USD (converted from the regional catalog price at record creation time)';
COMMENT ON COLUMN raw_material_cost_records.overhead_cost IS 'Overhead amount in USD; widened to 6 decimal places so sub-cent overhead on cheap low-currency materials does not round to zero';

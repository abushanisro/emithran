-- Migration: drop the duplicate aggregate currency column (P1b-iii, step 1)
-- Description: Removes bom_item_costs.currency, which migration 707 added
--              without noticing that bom_item_costs.currency_code already
--              existed. Keeps currency_code and currency_integrity.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- Migration 707 added bom_item_costs.currency with DEFAULT 'USD' to make the
-- rollup reporting currency explicit. That was a mistake: the table already had
-- a currency_code column, so the result was two currency columns on the same
-- row that contradicted each other on every row in the database --
--
--   currency_code      INR   (pre-existing, all 25 rows)
--   currency           USD   (from the 707 default)
--
-- Two columns disagreeing about the denomination of the same money is exactly
-- the duplicated source of truth this programme exists to remove, so the
-- column that should go is the one that was added last and asserted a value it
-- had no evidence for. Nothing read bom_item_costs.currency: the only
-- currency_code readers in the codebase are in
-- process-plan-generator/services/retrieval.service.ts, and they read
-- mhr_records / lhr_records, not this table.
--
-- currency_code is kept as-is. It is NOT renamed, duplicated or recreated --
-- renaming it would break nothing today but would churn a column that predates
-- this work for no benefit, and P1b-iii can write provenance to it directly.
--
-- Its stored 'INR' values are NOT authoritative and are not being trusted here.
-- They were never written by currency-aware code, which is precisely what
-- currency_integrity records: every row is still 'unverified', and P1b-iii only
-- promotes a row to 'consistent' after computing it from inputs whose own
-- currency declarations were checked.
--
-- Migrations 035, 037, 707 and 708 are not modified. This is a forward
-- correction of live schema, which is also why it is safe to run against a
-- database where 707 has already been applied.

-- currency_integrity was added by 708 and stays. It is the aggregate trust
-- state, independent of which currency column names the denomination.
ALTER TABLE bom_item_costs
  DROP COLUMN IF EXISTS currency;

COMMENT ON COLUMN bom_item_costs.currency_code IS
  'ISO 4217 reporting currency for the money columns on this row. Authoritative only when currency_integrity = consistent, which the application rollup sets after converting every input through one FX snapshot. Values predating that rollup were never written by currency-aware code and must not be trusted -- see currency_integrity. A BOM can span factories in different countries, so this aggregate cannot be denominated in any single factory local currency; it is a reporting currency chosen per rollup.';

-- Verification
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'bom_item_costs'
--      AND column_name IN ('currency', 'currency_code', 'currency_integrity')
--    ORDER BY column_name;
--
-- Expected exactly two rows: currency_code, currency_integrity.
-- 'currency' must be absent.

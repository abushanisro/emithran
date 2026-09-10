-- Migration: local-currency process-cost persistence (P1b-iv-c)
-- Description: Makes the last money-computing rollup trigger invalidate only,
--              and lifts the gate that forbade local-currency process rows.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- This is the change the whole P1 sequence was working towards:
--
--   engine local -> persisted local -> currency-consistent rollup -> display
--   conversion exactly once
--
-- It could not be done earlier, and each blocker had to be cleared first:
--
--   707  the persisted row could not say what currency it held.
--   708  the other four cost-record tables could not either.
--   709  three rollup triggers computed money they could not denominate.
--   710  the aggregate had two contradicting currency columns.
--   711  the aggregate could not explain an FX conversion.
--   1b-iii  one currency-aware application rollup now converts each declared
--           input exactly once through a single FX snapshot, so the rollup can
--           finally accept a non-USD process row.
--   1b-iv-b five separate code paths re-derived process cost from the RATE
--           columns instead of reading the engine cost. While that was true,
--           flipping the cost columns to local would have made every one of
--           them disagree with the row in currency as well as in value. They
--           now all read the stored cost, so the rate columns no longer drive
--           any total.
--
-- WHAT REMAINS IN SQL
--
-- sync_process_cost_to_bom_item is the last trigger still summing money. Once
-- process_cost_records holds local currency, that sum would push (for example)
-- INR into bom_item_costs.process_cost, which is denominated in the reporting
-- currency -- the exact defect refused back in 707. So it becomes invalidation
-- only, like its three siblings in 709, and the currency-aware application
-- rollup computes the aggregate.
--
-- HOW THIS MIGRATION PROTECTS ITSELF
--
-- The live definitions of these functions have drifted from their migration
-- files twice already: 999 exists because 041 was wrong in production, and the
-- live procured-parts function turned out NOT to recompute own_cost/total_cost
-- while its 041 file version does. CREATE OR REPLACE discards whatever is
-- there, so anything non-monetary in the live body would be lost silently.
--
-- Rather than trust a description of the body, the DO block below reads the
-- live definition, prints it, and ABORTS if it contains anything this migration
-- is not prepared to drop. If it aborts, nothing has changed and the printed
-- definition says why.

DO $$
DECLARE
  v_old text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_old
    FROM pg_proc p
   WHERE p.proname = 'sync_process_cost_to_bom_item';

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'sync_process_cost_to_bom_item does not exist -- refusing to guess what should replace it';
  END IF;

  -- Preserved in the migration output so the previous behaviour is recoverable
  -- from the run log, not only from a backup.
  RAISE NOTICE 'Replacing sync_process_cost_to_bom_item. Previous live definition follows:';
  RAISE NOTICE '%', v_old;

  -- Everything this migration knowingly drops is monetary: a SUM over
  -- total_cost_per_part, the writes to process_cost / own_cost / total_cost /
  -- unit_cost, and clearing is_stale. Anything else is behaviour nobody has
  -- accounted for, so fail closed instead of discarding it.
  --
  -- direct_children_cost and tooling_cost are deliberately NOT in this list,
  -- and they were on a first attempt -- which aborted this migration. That was
  -- a fault in the guard, not in the function: both are MONEY columns, and the
  -- only way this function touches them is by reading them inside the
  -- own_cost / total_cost expressions, exactly as the raw-material function
  -- does:
  --
  --   total_cost = ( v_aggregated_cost + bom_item_costs.process_cost
  --                + bom_item_costs.packaging_logistics_cost
  --                + bom_item_costs.procured_parts_cost
  --                + bom_item_costs.direct_children_cost )
  --
  -- Reading them IS the monetary rollup being removed, so matching on them
  -- flags the very thing this migration exists to drop. Listing a money column
  -- among markers meant to catch NON-monetary side effects was the error.
  --
  -- The abort was still worth having. Running the marker list against the live
  -- definition returned direct_children_cost and nothing else -- so
  -- last_calculated_at, calculation_version, organization_id, selling_price,
  -- extended_cost, sga_percentage, profit_percentage, PERFORM, mark_parent,
  -- DELETE FROM, NOTIFY and EXECUTE are all absent. That is the evidence that
  -- this function carries no non-monetary behaviour and the invalidate-only
  -- replacement below loses nothing, which is what could not be established by
  -- reading the migration files.
  IF v_old ~* '(last_calculated_at|calculation_version|organization_id|selling_price|extended_cost|sga_percentage|profit_percentage|PERFORM|mark_parent|DELETE FROM|NOTIFY|EXECUTE)' THEN
    RAISE EXCEPTION
      'sync_process_cost_to_bom_item contains behaviour beyond the monetary rollup this migration replaces. Aborting so it is not silently lost. Inspect the definition printed above and extend this migration deliberately.';
  END IF;
END $$;

-- The replacement. Identical in shape to the three functions migration 709
-- installed, for the same reason: a trigger has no FX snapshot and must not
-- decide a reporting currency.
CREATE OR REPLACE FUNCTION sync_process_cost_to_bom_item()
RETURNS TRIGGER AS $$
BEGIN
  -- Invalidate only. No SUM, no arithmetic, no money column referenced, no FX.
  -- The currency-aware application rollup computes the aggregate, because it is
  -- the only place that has the 707/708 currency declarations and a resolved FX
  -- snapshot available.
  INSERT INTO bom_item_costs (bom_item_id, user_id, is_stale, updated_at)
  VALUES (NEW.bom_item_id, NEW.user_id, true, NOW())
  ON CONFLICT (bom_item_id, user_id)
  DO UPDATE SET is_stale = true, updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_process_cost_to_bom_item() IS
  'Marks the BOM item aggregate stale when a process cost record changes. Performs no monetary arithmetic: process_cost_records now holds factory-local currency and this trigger has no FX snapshot, so the aggregate is computed by the application rollup. Migration 712.';

-- The gate can now be lifted.
--
-- 707 added this to make it impossible to persist local-currency money while
-- the rollup still assumed USD -- deliberately blocking half of P1 from
-- shipping on its own. The rollup understands currency as of 1b-iii and the
-- trigger above no longer sums, so the invariant it protected no longer
-- applies.
ALTER TABLE process_cost_records
  DROP CONSTRAINT IF EXISTS ck_process_cost_records_rollup_usd_until_p1b;

-- ck_process_cost_records_cost_currency_basis, _converted_is_traceable and
-- _local_agrees all REMAIN. Those are integrity constraints, not sequencing
-- gates: a 'local' row must still agree with its own declared currency.

COMMENT ON COLUMN process_cost_records.currency IS
  'ISO 4217 code every money column on this row is denominated in -- the three cost columns and the machine_rate / labor_rate / direct_rate columns alike. Route-applied rows are written in the factory local currency as of migration 712 (cost_currency_basis = local). Manually entered rows are still written in USD by process-cost.service.ts. Either way the row declares its own denomination: read this together with cost_currency_basis and never assume.';

-- Verification
--
-- 1. The trigger no longer touches money. Expected money_refs = 0.
--
--   SELECT (SELECT count(*) FROM regexp_matches(
--             pg_get_functiondef(p.oid),
--             '(raw_material_cost|packaging_logistics_cost|procured_parts_cost|process_cost|own_cost|total_cost|unit_cost)',
--             'g')) AS money_refs
--     FROM pg_proc p WHERE p.proname = 'sync_process_cost_to_bom_item';
--
-- 2. The gate is gone, the integrity constraints stay. Expected 3 rows,
--    none of them ck_process_cost_records_rollup_usd_until_p1b.
--
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'process_cost_records'::regclass
--      AND conname LIKE 'ck_process_cost_records%' ORDER BY 1;
--
-- 3. No existing money moved.
--
--   SELECT sum(total_cost_per_part) AS pcr_total FROM process_cost_records WHERE is_active;
--   SELECT sum(process_cost) AS agg_process, sum(own_cost) AS agg_own FROM bom_item_costs;
--
-- 4. A local-currency row is now accepted (run inside a transaction and roll
--    back, or on a scratch item only):
--
--   -- expected: succeeds, where before 712 it violated the gate
--   UPDATE process_cost_records
--      SET cost_currency_basis = 'local', currency = 'INR', cost_currency_local = 'INR'
--    WHERE id = '<scratch row id>';

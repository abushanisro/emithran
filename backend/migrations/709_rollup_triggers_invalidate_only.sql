-- Migration: BOM rollup triggers invalidate instead of computing money (P1b-ii)
-- Description: Replaces the three cost-record sync functions so they only mark
--              the aggregate stale. No monetary arithmetic remains in SQL.
--              Triggers themselves are untouched.
-- Date: 2026-09-08

-- WHY THIS EXISTS
--
-- These three functions computed BOM aggregate money in SQL, summing amounts
-- whose currencies they had no way to know. Migration 708 established that the
-- inputs genuinely differ: procured parts carries a caller-declared currency
-- (both live rows INR), tooling hardcoded USD while every live row held INR,
-- raw material converts to USD only on its auto-derive path, and packaging had
-- no currency column at all until 708. One live aggregate row (bom_item
-- b0eac6f0) already reports 973.6419 as USD for money that is mostly rupees.
--
-- SQL cannot fix that. A trigger has no access to an FX snapshot and must not
-- be the thing that decides a reporting currency. So the rule this migration
-- installs is:
--
--     cost record mutation -> SQL trigger -> mark aggregate stale
--   NOT
--     cost record mutation -> SQL trigger -> calculate aggregate money
--
-- The currency-aware rollup is implemented once, in application code, in
-- P1b-iii, where the 707/708 currency declarations and an FX snapshot are
-- actually available.
--
-- THE DEFINITIONS THIS REPLACES  (captured live via pg_get_functiondef,
-- not read from migration files, because the files are known to be wrong)
--
--   sync_raw_material_cost_to_bom_item
--     SUM(total_cost) over active rows for (bom_item_id, user_id), then
--     raw_material_cost = sum, and own_cost / total_cost / unit_cost
--     recomputed by adding process_cost, packaging_logistics_cost,
--     procured_parts_cost and (for total/unit) direct_children_cost.
--     is_stale = false, updated_at = NOW().
--
--   sync_procured_parts_cost_to_bom_item
--     SUM(total_cost) over active rows, then procured_parts_cost = sum.
--     is_stale = false, updated_at = NOW().
--     NOTE: the LIVE version does NOT recompute own_cost / total_cost /
--     unit_cost, while migration 041 file version DOES. Another instance of
--     the file/live drift that made capturing the live definition mandatory --
--     writing this migration from 041 would have silently reintroduced that
--     arithmetic.
--
--   sync_packaging_logistics_cost_to_bom_item
--     ALREADY in the invalidation-only form below, applied directly against
--     the database ahead of this migration. It is included here anyway, and
--     that is deliberate: its current live body exists in no migration file at
--     all, so a database rebuilt from migrations would silently restore the
--     money-computing version from 041. This migration is what puts all three
--     definitions under version control.
--
-- WHAT IS PRESERVED
--
--   * the upsert. All three were INSERT ... ON CONFLICT (bom_item_id, user_id)
--     DO UPDATE, so they CREATE the aggregate row when none exists. Reducing
--     them to a plain UPDATE would silently stop creating that row for a
--     first-ever cost record, which is a non-monetary behaviour change.
--   * (bom_item_id, user_id) targeting, taken from NEW exactly as before.
--   * updated_at = NOW().
--   * trigger timing and events. All three triggers are
--     AFTER INSERT OR UPDATE ... FOR EACH ROW with no WHEN clause and no
--     UPDATE OF column list (confirmed live via pg_get_triggerdef). They are
--     NOT redefined here -- they already reference these functions by name, so
--     replacing the function body is sufficient and avoids a window where a
--     trigger does not exist.
--
-- WHAT CHANGES, BESIDES REMOVING THE ARITHMETIC
--
--   is_stale flips from false to true. The old functions CLEARED the flag
--   because they had just computed the money; these SET it because the money
--   now needs computing elsewhere. Verified safe: nothing auto-recomputes on
--   this flag. getStaleCosts() in bom-item-cost.service.ts only LISTS stale
--   rows, and the two paths that write is_stale = false (lines 90 and 255) run
--   only when explicitly called. So this does not relocate the currency-blind
--   arithmetic into the application by a side door -- those explicit paths are
--   themselves the P1b-iii target.
--
-- WHAT IS NOT TOUCHED
--
--   * sync_process_cost_to_bom_item. Its active-generation SUM is correct for
--     this phase and is explicitly out of scope.
--   * bom_item_costs.process_cost / own_cost / total_cost / unit_cost
--     calculation logic. Existing rows keep their current values: DO UPDATE
--     below sets only is_stale and updated_at, so nothing is zeroed or
--     recomputed. We stop making these rows worse rather than blanking them.
--   * migrations 035, 037, 707, 708.
--   * the missing DELETE event. All three triggers fire on INSERT OR UPDATE
--     only, so a hard DELETE of a cost record never invalidates the aggregate.
--     That is a real pre-existing gap, unrelated to currency, and changing
--     trigger events without a demonstrated reason is out of scope here.
--
-- KNOWN CONSEQUENCE
--
--   A brand-new aggregate row is now created with zero money and
--   is_stale = true, and nothing recomputes it until P1b-iii exists. For a BOM
--   item that has no bom_item_costs row yet, entering a raw-material,
--   packaging or procured cost will leave its total reading 0 rather than the
--   currency-mixed figure it would have shown. Existing rows are unaffected.
--   Narrow but real, and it closes when P1b-iii lands.

-- 1. raw material

CREATE OR REPLACE FUNCTION sync_raw_material_cost_to_bom_item()
RETURNS TRIGGER AS $$
BEGIN
  -- Invalidate only. No SUM, no arithmetic, no money column referenced, no FX,
  -- no reporting-currency choice. P1b-iii computes the aggregate in
  -- application code, where the currency declarations from 707/708 and an FX
  -- snapshot are available.
  INSERT INTO bom_item_costs (bom_item_id, user_id, is_stale, updated_at)
  VALUES (NEW.bom_item_id, NEW.user_id, true, NOW())
  ON CONFLICT (bom_item_id, user_id)
  DO UPDATE SET is_stale = true, updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_raw_material_cost_to_bom_item() IS
  'Marks the BOM item aggregate stale when a raw material cost record changes. Performs no monetary arithmetic: the inputs to bom_item_costs are denominated in different currencies and SQL has no FX snapshot, so the aggregate is computed in application code (P1b-iii). Migration 709.';

-- 2. packaging and logistics

CREATE OR REPLACE FUNCTION sync_packaging_logistics_cost_to_bom_item()
RETURNS TRIGGER AS $$
BEGIN
  -- Invalidate only. See sync_raw_material_cost_to_bom_item above.
  INSERT INTO bom_item_costs (bom_item_id, user_id, is_stale, updated_at)
  VALUES (NEW.bom_item_id, NEW.user_id, true, NOW())
  ON CONFLICT (bom_item_id, user_id)
  DO UPDATE SET is_stale = true, updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_packaging_logistics_cost_to_bom_item() IS
  'Marks the BOM item aggregate stale when a packaging/logistics cost record changes. Performs no monetary arithmetic -- see sync_raw_material_cost_to_bom_item. Migration 709.';

-- 3. procured parts

CREATE OR REPLACE FUNCTION sync_procured_parts_cost_to_bom_item()
RETURNS TRIGGER AS $$
BEGIN
  -- Invalidate only. See sync_raw_material_cost_to_bom_item above.
  INSERT INTO bom_item_costs (bom_item_id, user_id, is_stale, updated_at)
  VALUES (NEW.bom_item_id, NEW.user_id, true, NOW())
  ON CONFLICT (bom_item_id, user_id)
  DO UPDATE SET is_stale = true, updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_procured_parts_cost_to_bom_item() IS
  'Marks the BOM item aggregate stale when a procured parts cost record changes. Performs no monetary arithmetic -- see sync_raw_material_cost_to_bom_item. Migration 709.';

-- Verification
--
-- 1. Prove no monetary column is referenced for arithmetic by any of the three.
--    Expected: three rows, each with money_refs = 0.
--
--   SELECT p.proname,
--          (SELECT count(*) FROM regexp_matches(
--             pg_get_functiondef(p.oid),
--             '(raw_material_cost|packaging_logistics_cost|procured_parts_cost|process_cost|own_cost|total_cost|unit_cost)',
--             'g')) AS money_refs
--     FROM pg_proc p
--    WHERE p.proname IN ('sync_raw_material_cost_to_bom_item',
--                        'sync_packaging_logistics_cost_to_bom_item',
--                        'sync_procured_parts_cost_to_bom_item')
--    ORDER BY 1;
--
-- 2. Confirm the installed bodies are the invalidation-only form.
--
--   SELECT proname, pg_get_functiondef(oid) FROM pg_proc
--    WHERE proname IN ('sync_raw_material_cost_to_bom_item',
--                      'sync_packaging_logistics_cost_to_bom_item',
--                      'sync_procured_parts_cost_to_bom_item');
--
-- 3. Confirm the triggers were not disturbed. Expected: all three still
--    AFTER INSERT OR UPDATE ... FOR EACH ROW.
--
--   SELECT tgname, tgrelid::regclass, pg_get_triggerdef(oid)
--     FROM pg_trigger WHERE NOT tgisinternal
--      AND tgname IN ('trigger_sync_raw_material_cost',
--                     'trigger_sync_packaging_logistics_cost',
--                     'trigger_sync_procured_parts_cost');
--
-- 4. Confirm the process trigger is untouched and still sums its generation.
--
--   SELECT pg_get_functiondef(oid) FROM pg_proc
--    WHERE proname = 'sync_process_cost_to_bom_item';
--
-- 5. Existing aggregate money must be unchanged by this migration.
--    Compare before and after:
--
--   SELECT sum(raw_material_cost), sum(packaging_logistics_cost),
--          sum(procured_parts_cost), sum(process_cost),
--          sum(own_cost), sum(total_cost), sum(unit_cost)
--     FROM bom_item_costs;

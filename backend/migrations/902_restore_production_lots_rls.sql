-- ============================================================================
-- Migration 902: Restore the BOM-owner RLS policies on production_lots and
-- production_lot_bom_items
--
-- Symptom (reproduced 2026-10-15): Projects → Production Planning → Create Lot
-- shows "Failed to create production lot". Backend log:
--   Error creating production lot: new row violates row-level security policy
--   for table "production_lots"
-- The request was made as the BOM's owner, and the service's own ownership
-- check (boms.user_id = caller) passed just before the insert, so the row was
-- rejected by the live policy, not by the app. The same owner's existing lots
-- also don't show on the page (Project Lots 0).
--
-- The backend authorizes production lots by BOM ownership everywhere
-- (createProductionLot's boms.user_id check, getProductionLots'
-- boms.user_id filter). Migrations 065/066 defined exactly that rule as RLS.
-- This puts those two policies back, with an explicit WITH CHECK for inserts.
--
-- Additive only: no other policy is dropped. Permissive policies are OR'd,
-- so any other access rule that exists keeps working. Every policy on the two
-- tables is printed first (RAISE NOTICE) so the live state is on record. A
-- RESTRICTIVE policy would still block inserts after this; the NOTICE names it.
-- ============================================================================

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT tablename, policyname, permissive, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('production_lots', 'production_lot_bom_items')
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'existing policy on %: "%" (%, %, roles=%) USING % WITH CHECK %',
      p.tablename, p.policyname, p.permissive, p.cmd, p.roles, p.qual, p.with_check;
  END LOOP;
END $$;

ALTER TABLE production_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_lot_bom_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage production_lots for their BOMs" ON production_lots;
CREATE POLICY "Users can manage production_lots for their BOMs"
  ON production_lots FOR ALL
  USING (EXISTS (
    SELECT 1 FROM boms b
    WHERE b.id = production_lots.bom_id AND b.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM boms b
    WHERE b.id = production_lots.bom_id AND b.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can manage production lot BOM items for their BOMs" ON production_lot_bom_items;
CREATE POLICY "Users can manage production lot BOM items for their BOMs"
  ON production_lot_bom_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM production_lots pl
    JOIN boms b ON pl.bom_id = b.id
    WHERE pl.id = production_lot_bom_items.production_lot_id
      AND b.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM production_lots pl
    JOIN boms b ON pl.bom_id = b.id
    WHERE pl.id = production_lot_bom_items.production_lot_id
      AND b.user_id = auth.uid()
  ));

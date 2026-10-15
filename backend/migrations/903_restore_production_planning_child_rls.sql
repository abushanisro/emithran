-- ============================================================================
-- Migration 903: Restore the BOM-owner RLS policies on the production-lot
-- child tables (follow-up to 902)
--
-- After 902, Create Lot got past production_lots and failed on the next write:
--   Failed to create default processes: new row violates row-level security
--   policy for table "production_processes"
-- Same cause as 902: the live policy rejects the BOM's owner. This restores
-- migration 065's own policies (access = you own the lot's BOM) for the child
-- tables the Production Planning module writes, with an explicit WITH CHECK
-- for inserts:
--   production_processes, process_subtasks, lot_vendor_assignments,
--   daily_production_entries
--
-- Additive only, like 902: no other policy is dropped. Each table is skipped
-- if it doesn't exist. Existing policies are printed first (RAISE NOTICE).
-- ============================================================================

DO $$
DECLARE
  p RECORD;
  -- table => condition proving the caller owns the row's BOM (065's rule)
  owner_check CONSTANT JSONB := jsonb_build_object(
    'production_processes',
      'EXISTS (SELECT 1 FROM production_lots pl JOIN boms b ON b.id = pl.bom_id
               WHERE pl.id = production_processes.production_lot_id AND b.user_id = auth.uid())',
    'process_subtasks',
      'EXISTS (SELECT 1 FROM production_processes pp
               JOIN production_lots pl ON pl.id = pp.production_lot_id
               JOIN boms b ON b.id = pl.bom_id
               WHERE pp.id = process_subtasks.production_process_id AND b.user_id = auth.uid())',
    'lot_vendor_assignments',
      'EXISTS (SELECT 1 FROM production_lots pl JOIN boms b ON b.id = pl.bom_id
               WHERE pl.id = lot_vendor_assignments.production_lot_id AND b.user_id = auth.uid())',
    'daily_production_entries',
      'EXISTS (SELECT 1 FROM production_lots pl JOIN boms b ON b.id = pl.bom_id
               WHERE pl.id = daily_production_entries.production_lot_id AND b.user_id = auth.uid())'
  );
  policy_name CONSTANT JSONB := jsonb_build_object(
    'production_processes',     'Users can manage production_processes',
    'process_subtasks',         'Users can manage process_subtasks',
    'lot_vendor_assignments',   'Users can manage lot_vendor_assignments',
    'daily_production_entries', 'Users can manage daily_production_entries'
  );
  t TEXT;
BEGIN
  FOR p IN
    SELECT tablename, policyname, permissive, cmd, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (SELECT jsonb_object_keys(owner_check))
    ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'existing policy on %: "%" (%, %, roles=%) USING % WITH CHECK %',
      p.tablename, p.policyname, p.permissive, p.cmd, p.roles, p.qual, p.with_check;
  END LOOP;

  FOR t IN SELECT jsonb_object_keys(owner_check) LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping %: table does not exist', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name->>t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
      policy_name->>t, t, owner_check->>t, owner_check->>t
    );
    RAISE NOTICE 'restored policy on %', t;
  END LOOP;
END $$;

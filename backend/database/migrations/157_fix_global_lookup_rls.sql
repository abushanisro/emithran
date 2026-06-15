-- Migration 157: Fix RLS on global lookup tables
--
-- Two classes of tables need different RLS treatment:
--
--   GLOBAL LOOKUP (no user_id column):
--     process_calculator_mappings — system reference data, same for all users
--     → SELECT: allow all authenticated users  (USING true)
--     → INSERT/UPDATE/DELETE: no app-layer policy (service_role only)
--
--   LIBRARY DATA (user_id nullable, is_global flag):
--     calculators — already fixed by migration 156's pattern, but the
--     application query was also filtering via .eq('user_id') at the
--     query level. That code fix is in calculators.service.ts. This
--     migration only handles the DB-side RLS.
--
-- ── process_calculator_mappings ──────────────────────────────────────────────

ALTER TABLE process_calculator_mappings ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies regardless of name
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'process_calculator_mappings'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

-- All authenticated users can read global lookup data
CREATE POLICY "global_lookup_select" ON process_calculator_mappings
  FOR SELECT USING (true);

-- ── calculators — also drop INSERT/UPDATE/DELETE policies added before ────────
-- Migration 156 added SELECT + INSERT + UPDATE + DELETE policies on calculators.
-- Those are correct. Nothing extra needed here.
-- But if calculators had no INSERT/UPDATE/DELETE policies before migration 156,
-- those mutations would be blocked by RLS after enabling it.
-- Ensure non-SELECT mutations still work for the owning user.

DO $$
BEGIN
  -- Only add if missing (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'calculators' AND cmd = 'INSERT'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "calc_insert_own" ON calculators
        FOR INSERT WITH CHECK (user_id = auth.uid())
    $p$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'calculators' AND cmd = 'UPDATE'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "calc_update_own" ON calculators
        FOR UPDATE USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid())
    $p$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'calculators' AND cmd = 'DELETE'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "calc_delete_own" ON calculators
        FOR DELETE USING (user_id = auth.uid())
    $p$;
  END IF;
END $$;

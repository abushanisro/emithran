-- Migration 156: Promote all master/library data to global visibility
--
-- Architecture rule (industry standard for multi-tenant SaaS):
--
--   LIBRARY DATA   → is_global = TRUE, user_id = NULL or any
--                    Visible to ALL authenticated users.
--                    Examples: materials, MHR rates, LSR bands, calculators.
--
--   PROJECT DATA   → is_global = FALSE, user_id = owner's UUID
--                    Visible ONLY to the owner.
--                    Examples: BOM items, cost records, generations, projects.
--
-- This migration:
--   1. Marks all existing master table records as is_global = TRUE
--   2. Drops old restrictive SELECT-only RLS policies on master tables
--   3. Creates new global-aware RLS policies (own + global readable; own writable)
--
-- Run migration 155 before this (adds is_global column).
-- ──────────────────────────────────────────────────────────────────────────────

-- ── 1. Promote all existing master records to global ─────────────────────────

UPDATE raw_materials SET is_global = TRUE;   -- all reference materials become library
UPDATE mhr_records    SET is_global = TRUE;   -- all machine rates (Atulay + benchmark)
UPDATE lsr_records    SET is_global = TRUE;   -- all labour bands
UPDATE calculators    SET is_global = TRUE;   -- all calculators

-- ── 2. Drop existing SELECT policies on master tables (replace below) ─────────
--
-- We use a DO block to drop all existing SELECT policies regardless of name,
-- so this migration is safe to run no matter what the policies were called.

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename IN ('raw_materials', 'mhr_records', 'lsr_records', 'calculators')
    AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

-- ── 3. New global-aware RLS policies ─────────────────────────────────────────
--
-- SELECT: user sees their own records + all global/library records
-- INSERT: user can only create records owned by themselves
-- UPDATE/DELETE: user can only modify their own records
--
-- Master tables that already have RLS enabled get updated policies.
-- Master tables that had RLS disabled can have it enabled safely.

-- raw_materials
ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_select_own_and_global" ON raw_materials
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR is_global = TRUE
  );

CREATE POLICY "master_insert_own" ON raw_materials
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_update_own" ON raw_materials
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_delete_own" ON raw_materials
  FOR DELETE USING (user_id = auth.uid());

-- mhr_records
ALTER TABLE mhr_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_select_own_and_global" ON mhr_records
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR is_global = TRUE
  );

CREATE POLICY "master_insert_own" ON mhr_records
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_update_own" ON mhr_records
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_delete_own" ON mhr_records
  FOR DELETE USING (user_id = auth.uid());

-- lsr_records
ALTER TABLE lsr_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_select_own_and_global" ON lsr_records
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR is_global = TRUE
  );

CREATE POLICY "master_insert_own" ON lsr_records
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_update_own" ON lsr_records
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_delete_own" ON lsr_records
  FOR DELETE USING (user_id = auth.uid());

-- calculators
ALTER TABLE calculators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_select_own_and_global" ON calculators
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR is_global = TRUE
  );

CREATE POLICY "master_insert_own" ON calculators
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_update_own" ON calculators
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_delete_own" ON calculators
  FOR DELETE USING (user_id = auth.uid());

-- ── processes table (used by AI retrieval — should also be globally readable) ─
ALTER TABLE processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_select_own_and_global" ON processes
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR is_global = TRUE
  );

CREATE POLICY "master_insert_own" ON processes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_update_own" ON processes
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "master_delete_own" ON processes
  FOR DELETE USING (user_id = auth.uid());

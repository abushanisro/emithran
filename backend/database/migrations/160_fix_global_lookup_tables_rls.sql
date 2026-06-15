-- Migration 160: Fix RLS on all global lookup / reference tables
--
-- Problems found:
--
-- 1. process_reference_tables + process_table_rows
--    Migration 021 applied `USING (auth.uid() = user_id ...)` but neither
--    table has a user_id column, so the policy is either broken or blocks
--    every authenticated user. These are global reference data (cavity
--    pressure tables, material viscosity tables, etc.) — all users must read.
--
-- 2. processes table
--    Migration 156 tried to create a SELECT policy referencing `is_global`,
--    but is_global was never added to the processes table (migration 155 only
--    covered raw_materials, mhr_records, lsr_records, calculators). The
--    policy likely failed, leaving the old FOR ALL / user_id-only policy in
--    place — so new users see 0 processes in the library.
--
-- Fix:
--   a. Add is_global to processes, mark all existing as global
--   b. Replace SELECT policy on processes to include is_global = TRUE
--   c. Drop all policies on process_reference_tables and process_table_rows
--   d. Create USING (true) SELECT policies on those two tables
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. processes — add is_global column ──────────────────────────────────────

ALTER TABLE processes
  ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_processes_is_global ON processes (is_global);

-- Mark all existing library processes as global
UPDATE processes SET is_global = TRUE;

-- Drop ALL existing SELECT policies on processes (from migration 020/156)
DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'processes' AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

ALTER TABLE processes ENABLE ROW LEVEL SECURITY;

-- SELECT: own records + global library records
CREATE POLICY "processes_select_own_and_global" ON processes
  FOR SELECT USING (
    user_id = auth.uid()
    OR user_id IS NULL
    OR is_global = TRUE
  );

-- Mutations remain owner-only
CREATE POLICY "processes_insert_own" ON processes
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "processes_update_own" ON processes
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "processes_delete_own" ON processes
  FOR DELETE USING (user_id = auth.uid());

-- ── 2. process_reference_tables — global read ────────────────────────────────

ALTER TABLE process_reference_tables ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'process_reference_tables'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

-- All authenticated users can read reference tables
CREATE POLICY "process_ref_tables_select" ON process_reference_tables
  FOR SELECT USING (true);

-- ── 3. process_table_rows — global read ──────────────────────────────────────

ALTER TABLE process_table_rows ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE rec RECORD;
BEGIN
  FOR rec IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE tablename = 'process_table_rows'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   rec.policyname, rec.schemaname, rec.tablename);
  END LOOP;
END $$;

CREATE POLICY "process_table_rows_select" ON process_table_rows
  FOR SELECT USING (true);

-- ── Verify ───────────────────────────────────────────────────────────────────
DO $$
DECLARE
  proc_total    INTEGER;
  proc_global   INTEGER;
  ref_tables    INTEGER;
  ref_rows      INTEGER;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_global = TRUE)
  INTO proc_total, proc_global
  FROM processes;

  SELECT COUNT(*) INTO ref_tables FROM process_reference_tables;
  SELECT COUNT(*) INTO ref_rows   FROM process_table_rows;

  RAISE NOTICE 'Processes: % total, % global', proc_total, proc_global;
  RAISE NOTICE 'Process reference tables: %', ref_tables;
  RAISE NOTICE 'Process table rows: %', ref_rows;
END $$;

-- Migration 169: Add INSERT / UPDATE / DELETE RLS policies on
-- process_reference_tables and process_table_rows.
--
-- Migration 160 only added SELECT USING (true). The tables have no user_id
-- column, so write access is scoped via the parent process (user_id = auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── process_reference_tables write policies ───────────────────────────────────

CREATE POLICY "process_ref_tables_insert_own" ON process_reference_tables
  FOR INSERT WITH CHECK (
    process_id IN (
      SELECT id FROM processes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "process_ref_tables_update_own" ON process_reference_tables
  FOR UPDATE
  USING (
    process_id IN (
      SELECT id FROM processes WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    process_id IN (
      SELECT id FROM processes WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "process_ref_tables_delete_own" ON process_reference_tables
  FOR DELETE USING (
    process_id IN (
      SELECT id FROM processes WHERE user_id = auth.uid()
    )
  );

-- ── process_table_rows write policies ────────────────────────────────────────

CREATE POLICY "process_table_rows_insert_own" ON process_table_rows
  FOR INSERT WITH CHECK (
    table_id IN (
      SELECT id FROM process_reference_tables
      WHERE process_id IN (
        SELECT id FROM processes WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "process_table_rows_update_own" ON process_table_rows
  FOR UPDATE
  USING (
    table_id IN (
      SELECT id FROM process_reference_tables
      WHERE process_id IN (
        SELECT id FROM processes WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    table_id IN (
      SELECT id FROM process_reference_tables
      WHERE process_id IN (
        SELECT id FROM processes WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "process_table_rows_delete_own" ON process_table_rows
  FOR DELETE USING (
    table_id IN (
      SELECT id FROM process_reference_tables
      WHERE process_id IN (
        SELECT id FROM processes WHERE user_id = auth.uid()
      )
    )
  );

-- ── Verify ────────────────────────────────────────────────────────────────────
DO $$
DECLARE ref_policies INTEGER; row_policies INTEGER;
BEGIN
  SELECT COUNT(*) INTO ref_policies
  FROM pg_policies WHERE tablename = 'process_reference_tables';

  SELECT COUNT(*) INTO row_policies
  FROM pg_policies WHERE tablename = 'process_table_rows';

  RAISE NOTICE 'process_reference_tables policies: %', ref_policies;
  RAISE NOTICE 'process_table_rows policies: %', row_policies;
END $$;

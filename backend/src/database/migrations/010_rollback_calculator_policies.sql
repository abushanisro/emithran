-- ================================================================
-- ROLLBACK Migration 010: Restore Original Calculator RLS Policies
-- Use this ONLY if 010 needs to be reverted
-- ================================================================

BEGIN;

-- Drop the emergency policies
DROP POLICY IF EXISTS "calc_select_emergency" ON calculators;
DROP POLICY IF EXISTS "calc_insert_emergency" ON calculators;
DROP POLICY IF EXISTS "calc_update_emergency" ON calculators;
DROP POLICY IF EXISTS "calc_delete_emergency" ON calculators;

-- Restore the original policies from migration 009
CREATE POLICY "All authenticated users can view all calculators"
ON calculators FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "All authenticated users can insert calculators"
ON calculators FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "All authenticated users can update calculators"
ON calculators FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "All authenticated users can delete calculators"
ON calculators FOR DELETE
TO authenticated
USING (auth.uid() IS NOT NULL);

COMMENT ON POLICY "All authenticated users can view all calculators" ON calculators IS 
'Restored from rollback of migration 010';

COMMIT;
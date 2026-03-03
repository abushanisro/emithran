-- ================================================================
-- Migration 010: Fix Calculator RLS Policies
-- Issue: Permission denied for table users during calculator updates
-- Solution: Replace auth.users dependent policies with simple ones
-- ================================================================

-- Store current policies for rollback (if needed)
-- SELECT policyname, qual, with_check FROM pg_policies WHERE tablename = 'calculators';

BEGIN;

-- Drop ALL existing calculator policies (including ones from previous migrations)
DROP POLICY IF EXISTS "Users can update only their own calculators (master data is read-only)" ON calculators;
DROP POLICY IF EXISTS "Master user can update all calculators" ON calculators;
DROP POLICY IF EXISTS "Users can delete only their own calculators (master data is protected)" ON calculators;
DROP POLICY IF EXISTS "Master user can delete all calculators" ON calculators;
DROP POLICY IF EXISTS "Authenticated users can view all calculators" ON calculators;
DROP POLICY IF EXISTS "Authenticated users can insert calculators" ON calculators;
DROP POLICY IF EXISTS "All authenticated users can view all calculators" ON calculators;
DROP POLICY IF EXISTS "All authenticated users can insert calculators" ON calculators;
DROP POLICY IF EXISTS "All authenticated users can update calculators" ON calculators;
DROP POLICY IF EXISTS "All authenticated users can delete calculators" ON calculators;

-- Create simple policies that work without auth.users table access
CREATE POLICY "calc_select_emergency" 
ON calculators FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "calc_insert_emergency" 
ON calculators FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calc_update_emergency" 
ON calculators FOR UPDATE 
TO authenticated 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calc_delete_emergency" 
ON calculators FOR DELETE 
TO authenticated 
USING (auth.uid() IS NOT NULL);

-- Ensure RLS is enabled
ALTER TABLE calculators ENABLE ROW LEVEL SECURITY;

-- Add comments for tracking
COMMENT ON POLICY "calc_select_emergency" ON calculators IS 
'Emergency fix: Allows read access without auth.users table dependency';

COMMENT ON POLICY "calc_update_emergency" ON calculators IS 
'Emergency fix: Allows update access without auth.users table dependency';

COMMIT;
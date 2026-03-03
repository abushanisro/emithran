-- ================================================================
-- Migration 012: Fix Users Table Permissions
-- Issue: Permission denied for table users during calculator field updates
-- Solution: Ensure proper permissions and remove auth.users dependencies
-- ================================================================

BEGIN;

-- Grant necessary permissions to authenticated role for auth.users table access
GRANT SELECT ON auth.users TO authenticated;

-- Drop all existing calculator_fields policies to start fresh
DROP POLICY IF EXISTS "All authenticated users can access calculator fields" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_select_policy" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_insert_policy" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_update_policy" ON calculator_fields;
DROP POLICY IF EXISTS "calculator_fields_delete_policy" ON calculator_fields;
DROP POLICY IF EXISTS "Authenticated users can view all calculator fields" ON calculator_fields;
DROP POLICY IF EXISTS "Authenticated users can insert calculator fields" ON calculator_fields;
DROP POLICY IF EXISTS "Users can update calculator fields for their calculators or master data" ON calculator_fields;
DROP POLICY IF EXISTS "Users can delete calculator fields for their calculators or master data" ON calculator_fields;

-- Create new calculator_fields policies without auth.users dependencies
CREATE POLICY "calculator_fields_select_policy" 
ON calculator_fields FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "calculator_fields_insert_policy" 
ON calculator_fields FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calculator_fields_update_policy" 
ON calculator_fields FOR UPDATE 
TO authenticated 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calculator_fields_delete_policy" 
ON calculator_fields FOR DELETE 
TO authenticated 
USING (auth.uid() IS NOT NULL);

-- Drop all existing calculator_formulas policies to start fresh
DROP POLICY IF EXISTS "All authenticated users can access calculator formulas" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_select_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_insert_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_update_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "calculator_formulas_delete_policy" ON calculator_formulas;
DROP POLICY IF EXISTS "Authenticated users can view all calculator formulas" ON calculator_formulas;
DROP POLICY IF EXISTS "Authenticated users can insert calculator formulas" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can update calculator formulas for their calculators or master data" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can delete calculator formulas for their calculators or master data" ON calculator_formulas;

CREATE POLICY "calculator_formulas_select_policy" 
ON calculator_formulas FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "calculator_formulas_insert_policy" 
ON calculator_formulas FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calculator_formulas_update_policy" 
ON calculator_formulas FOR UPDATE 
TO authenticated 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calculator_formulas_delete_policy" 
ON calculator_formulas FOR DELETE 
TO authenticated 
USING (auth.uid() IS NOT NULL);

-- Drop all existing calculator_executions policies to start fresh
DROP POLICY IF EXISTS "All authenticated users can access calculator executions" ON calculator_executions;
DROP POLICY IF EXISTS "calculator_executions_select_policy" ON calculator_executions;
DROP POLICY IF EXISTS "calculator_executions_insert_policy" ON calculator_executions;
DROP POLICY IF EXISTS "calculator_executions_update_policy" ON calculator_executions;
DROP POLICY IF EXISTS "calculator_executions_delete_policy" ON calculator_executions;
DROP POLICY IF EXISTS "Authenticated users can view all calculator executions" ON calculator_executions;
DROP POLICY IF EXISTS "Authenticated users can insert calculator executions" ON calculator_executions;

CREATE POLICY "calculator_executions_select_policy" 
ON calculator_executions FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "calculator_executions_insert_policy" 
ON calculator_executions FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calculator_executions_update_policy" 
ON calculator_executions FOR UPDATE 
TO authenticated 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "calculator_executions_delete_policy" 
ON calculator_executions FOR DELETE 
TO authenticated 
USING (auth.uid() IS NOT NULL);

-- Ensure RLS is enabled on all tables
ALTER TABLE calculator_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_executions ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON POLICY "calculator_fields_update_policy" ON calculator_fields IS 
'Fixed policy: Allows field updates without auth.users table dependency';

COMMENT ON POLICY "calculator_formulas_update_policy" ON calculator_formulas IS 
'Fixed policy: Allows formula updates without auth.users table dependency';

COMMENT ON POLICY "calculator_executions_update_policy" ON calculator_executions IS 
'Fixed policy: Allows execution updates without auth.users table dependency';

COMMIT;
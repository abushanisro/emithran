-- ================================================================
-- SHARED CALCULATOR POLICIES
-- Make calculators shared across all users like vendors
-- ================================================================

-- Drop existing user-isolated policies
DROP POLICY IF EXISTS "Users can view their own calculators or public calculators" ON calculators;
DROP POLICY IF EXISTS "Users can view their own calculators and public templates" ON calculators;
DROP POLICY IF EXISTS "Users can insert calculators" ON calculators;
DROP POLICY IF EXISTS "Users can update their own calculators" ON calculators;
DROP POLICY IF EXISTS "Users can delete their own calculators" ON calculators;

-- Drop policies for related tables
DROP POLICY IF EXISTS "Users can view calculator fields" ON calculator_fields;
DROP POLICY IF EXISTS "Users can insert calculator fields" ON calculator_fields;
DROP POLICY IF EXISTS "Users can update calculator fields" ON calculator_fields;
DROP POLICY IF EXISTS "Users can delete calculator fields" ON calculator_fields;

DROP POLICY IF EXISTS "Users can view calculator formulas" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can insert calculator formulas" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can update calculator formulas" ON calculator_formulas;
DROP POLICY IF EXISTS "Users can delete calculator formulas" ON calculator_formulas;

DROP POLICY IF EXISTS "Users can view calculator executions" ON calculator_executions;
DROP POLICY IF EXISTS "Users can insert calculator executions" ON calculator_executions;

-- Create new shared policies for calculators (like vendors)
CREATE POLICY "Authenticated users can view all calculators"
ON calculators FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert calculators"
ON calculators FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own calculators or master data calculators"
ON calculators FOR UPDATE
TO authenticated
USING (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
WITH CHECK (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'));

CREATE POLICY "Users can delete their own calculators or master data calculators"
ON calculators FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'));

-- Create shared policies for calculator_fields
CREATE POLICY "Authenticated users can view all calculator fields"
ON calculator_fields FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert calculator fields"
ON calculator_fields FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM calculators 
    WHERE id = calculator_fields.calculator_id 
    AND (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
));

CREATE POLICY "Users can update calculator fields for their calculators or master data"
ON calculator_fields FOR UPDATE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM calculators 
    WHERE id = calculator_fields.calculator_id 
    AND (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
));

CREATE POLICY "Users can delete calculator fields for their calculators or master data"
ON calculator_fields FOR DELETE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM calculators 
    WHERE id = calculator_fields.calculator_id 
    AND (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
));

-- Create shared policies for calculator_formulas
CREATE POLICY "Authenticated users can view all calculator formulas"
ON calculator_formulas FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert calculator formulas"
ON calculator_formulas FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM calculators 
    WHERE id = calculator_formulas.calculator_id 
    AND (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
));

CREATE POLICY "Users can update calculator formulas for their calculators or master data"
ON calculator_formulas FOR UPDATE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM calculators 
    WHERE id = calculator_formulas.calculator_id 
    AND (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
));

CREATE POLICY "Users can delete calculator formulas for their calculators or master data"
ON calculator_formulas FOR DELETE
TO authenticated
USING (EXISTS (
    SELECT 1 FROM calculators 
    WHERE id = calculator_formulas.calculator_id 
    AND (user_id = auth.uid() OR user_id = (SELECT auth.uid() FROM auth.users WHERE email = 'emuski@mithran.com'))
));

-- Create shared policies for calculator_executions
CREATE POLICY "Authenticated users can view all calculator executions"
ON calculator_executions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert calculator executions"
ON calculator_executions FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Enable RLS on all tables if not already enabled
ALTER TABLE calculators ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_formulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE calculator_executions ENABLE ROW LEVEL SECURITY;

-- Create indexes for performance (if not exist)
CREATE INDEX IF NOT EXISTS idx_calculators_shared_access ON calculators(user_id, is_public, is_template);
CREATE INDEX IF NOT EXISTS idx_calculator_fields_calculator ON calculator_fields(calculator_id);
CREATE INDEX IF NOT EXISTS idx_calculator_formulas_calculator ON calculator_formulas(calculator_id);
CREATE INDEX IF NOT EXISTS idx_calculator_executions_user ON calculator_executions(user_id, calculator_id);

COMMENT ON POLICY "Authenticated users can view all calculators" ON calculators IS 
'All authenticated users can view all calculators (shared like vendors)';

COMMENT ON POLICY "Users can update their own calculators or master data calculators" ON calculators IS 
'Users can edit their own calculators, emuski@mithran.com can edit master data calculators';
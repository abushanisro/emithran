-- ============================================================================
-- Migration: RLS policies for supplier_nomination_evaluations
-- Table was created in 060 but RLS policies were never defined,
-- causing INSERT to fail with a policy violation.
-- ============================================================================

ALTER TABLE supplier_nomination_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own supplier nominations" ON supplier_nomination_evaluations;
DROP POLICY IF EXISTS "Users can insert their own supplier nominations" ON supplier_nomination_evaluations;
DROP POLICY IF EXISTS "Users can update their own supplier nominations" ON supplier_nomination_evaluations;
DROP POLICY IF EXISTS "Users can delete their own supplier nominations" ON supplier_nomination_evaluations;

CREATE POLICY "Users can view their own supplier nominations"
  ON supplier_nomination_evaluations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own supplier nominations"
  ON supplier_nomination_evaluations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own supplier nominations"
  ON supplier_nomination_evaluations FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own supplier nominations"
  ON supplier_nomination_evaluations FOR DELETE
  USING (user_id = auth.uid());

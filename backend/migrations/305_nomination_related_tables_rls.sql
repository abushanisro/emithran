-- ============================================================================
-- Migration: RLS policies for all nomination-related tables
-- These tables were created in migrations 060/063 without RLS policies.
-- Ownership is derived via nomination_evaluation_id → supplier_nomination_evaluations.user_id
-- ============================================================================

-- Helper: drop and recreate any broken policy on vendor_nomination_evaluations
-- (migration 021 may have created one referencing a non-existent user_id column)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vendor_nomination_evaluations'
    AND policyname = 'Authorized users can manage their vendor nomination evaluations'
  ) THEN
    EXECUTE 'DROP POLICY "Authorized users can manage their vendor nomination evaluations" ON vendor_nomination_evaluations';
  END IF;
END $$;

-- ============================================================================
-- vendor_nomination_evaluations
-- ============================================================================

ALTER TABLE vendor_nomination_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view vendor nomination evaluations" ON vendor_nomination_evaluations;
DROP POLICY IF EXISTS "Users can insert vendor nomination evaluations" ON vendor_nomination_evaluations;
DROP POLICY IF EXISTS "Users can update vendor nomination evaluations" ON vendor_nomination_evaluations;
DROP POLICY IF EXISTS "Users can delete vendor nomination evaluations" ON vendor_nomination_evaluations;

CREATE POLICY "Users can view vendor nomination evaluations"
  ON vendor_nomination_evaluations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = vendor_nomination_evaluations.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert vendor nomination evaluations"
  ON vendor_nomination_evaluations FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = vendor_nomination_evaluations.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can update vendor nomination evaluations"
  ON vendor_nomination_evaluations FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = vendor_nomination_evaluations.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete vendor nomination evaluations"
  ON vendor_nomination_evaluations FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = vendor_nomination_evaluations.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

-- ============================================================================
-- nomination_evaluation_criteria
-- ============================================================================

ALTER TABLE nomination_evaluation_criteria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view nomination criteria" ON nomination_evaluation_criteria;
DROP POLICY IF EXISTS "Users can insert nomination criteria" ON nomination_evaluation_criteria;
DROP POLICY IF EXISTS "Users can update nomination criteria" ON nomination_evaluation_criteria;
DROP POLICY IF EXISTS "Users can delete nomination criteria" ON nomination_evaluation_criteria;

CREATE POLICY "Users can view nomination criteria"
  ON nomination_evaluation_criteria FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = nomination_evaluation_criteria.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert nomination criteria"
  ON nomination_evaluation_criteria FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = nomination_evaluation_criteria.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can update nomination criteria"
  ON nomination_evaluation_criteria FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = nomination_evaluation_criteria.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete nomination criteria"
  ON nomination_evaluation_criteria FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = nomination_evaluation_criteria.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

-- ============================================================================
-- vendor_evaluation_scores
-- ============================================================================

ALTER TABLE vendor_evaluation_scores ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vendor_evaluation_scores'
    AND policyname = 'Authorized users can manage their vendor evaluation scores'
  ) THEN
    EXECUTE 'DROP POLICY "Authorized users can manage their vendor evaluation scores" ON vendor_evaluation_scores';
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can view vendor evaluation scores" ON vendor_evaluation_scores;
DROP POLICY IF EXISTS "Users can insert vendor evaluation scores" ON vendor_evaluation_scores;
DROP POLICY IF EXISTS "Users can update vendor evaluation scores" ON vendor_evaluation_scores;
DROP POLICY IF EXISTS "Users can delete vendor evaluation scores" ON vendor_evaluation_scores;

CREATE POLICY "Users can view vendor evaluation scores"
  ON vendor_evaluation_scores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM vendor_nomination_evaluations vne
    JOIN supplier_nomination_evaluations sne ON sne.id = vne.nomination_evaluation_id
    WHERE vne.id = vendor_evaluation_scores.vendor_nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert vendor evaluation scores"
  ON vendor_evaluation_scores FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM vendor_nomination_evaluations vne
    JOIN supplier_nomination_evaluations sne ON sne.id = vne.nomination_evaluation_id
    WHERE vne.id = vendor_evaluation_scores.vendor_nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can update vendor evaluation scores"
  ON vendor_evaluation_scores FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM vendor_nomination_evaluations vne
    JOIN supplier_nomination_evaluations sne ON sne.id = vne.nomination_evaluation_id
    WHERE vne.id = vendor_evaluation_scores.vendor_nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete vendor evaluation scores"
  ON vendor_evaluation_scores FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM vendor_nomination_evaluations vne
    JOIN supplier_nomination_evaluations sne ON sne.id = vne.nomination_evaluation_id
    WHERE vne.id = vendor_evaluation_scores.vendor_nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

-- ============================================================================
-- supplier_nomination_bom_parts
-- ============================================================================

ALTER TABLE supplier_nomination_bom_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view nomination bom parts" ON supplier_nomination_bom_parts;
DROP POLICY IF EXISTS "Users can insert nomination bom parts" ON supplier_nomination_bom_parts;
DROP POLICY IF EXISTS "Users can update nomination bom parts" ON supplier_nomination_bom_parts;
DROP POLICY IF EXISTS "Users can delete nomination bom parts" ON supplier_nomination_bom_parts;

CREATE POLICY "Users can view nomination bom parts"
  ON supplier_nomination_bom_parts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = supplier_nomination_bom_parts.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert nomination bom parts"
  ON supplier_nomination_bom_parts FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = supplier_nomination_bom_parts.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can update nomination bom parts"
  ON supplier_nomination_bom_parts FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = supplier_nomination_bom_parts.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete nomination bom parts"
  ON supplier_nomination_bom_parts FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_evaluations sne
    WHERE sne.id = supplier_nomination_bom_parts.nomination_evaluation_id
    AND sne.user_id = auth.uid()
  ));

-- ============================================================================
-- supplier_nomination_bom_part_vendors
-- ============================================================================

ALTER TABLE supplier_nomination_bom_part_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view nomination bom part vendors" ON supplier_nomination_bom_part_vendors;
DROP POLICY IF EXISTS "Users can insert nomination bom part vendors" ON supplier_nomination_bom_part_vendors;
DROP POLICY IF EXISTS "Users can delete nomination bom part vendors" ON supplier_nomination_bom_part_vendors;

CREATE POLICY "Users can view nomination bom part vendors"
  ON supplier_nomination_bom_part_vendors FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_bom_parts snbp
    JOIN supplier_nomination_evaluations sne ON sne.id = snbp.nomination_evaluation_id
    WHERE snbp.id = supplier_nomination_bom_part_vendors.nomination_bom_part_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert nomination bom part vendors"
  ON supplier_nomination_bom_part_vendors FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM supplier_nomination_bom_parts snbp
    JOIN supplier_nomination_evaluations sne ON sne.id = snbp.nomination_evaluation_id
    WHERE snbp.id = supplier_nomination_bom_part_vendors.nomination_bom_part_id
    AND sne.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete nomination bom part vendors"
  ON supplier_nomination_bom_part_vendors FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM supplier_nomination_bom_parts snbp
    JOIN supplier_nomination_evaluations sne ON sne.id = snbp.nomination_evaluation_id
    WHERE snbp.id = supplier_nomination_bom_part_vendors.nomination_bom_part_id
    AND sne.user_id = auth.uid()
  ));

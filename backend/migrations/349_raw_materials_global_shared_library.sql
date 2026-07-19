-- ============================================================================
-- MIGRATION 349: Make raw_materials a global shared library
-- ============================================================================
-- Changes:
--   1. Make user_id nullable — rows are not scoped to a single owner.
--   2. Drop the per-user RLS policy and replace with:
--        SELECT  — any authenticated user can read all rows
--        INSERT  — any authenticated user can insert (they set user_id for audit)
--        UPDATE  — any authenticated user can update any row
--        DELETE  — any authenticated user can delete any row
-- ============================================================================

-- 1. Drop the NOT NULL constraint on user_id so global (non-user-owned) rows
--    can be inserted without a mandatory owner.
ALTER TABLE raw_materials
  ALTER COLUMN user_id DROP NOT NULL;

-- 2. Drop the existing per-user policy
DROP POLICY IF EXISTS "Users can manage their raw_materials" ON raw_materials;

-- 3. Global SELECT — all authenticated users see all materials
CREATE POLICY "Authenticated users can read all raw_materials"
  ON raw_materials FOR SELECT
  USING (auth.role() = 'authenticated');

-- 4. Global INSERT — any authenticated user can add materials
CREATE POLICY "Authenticated users can insert raw_materials"
  ON raw_materials FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 5. Global UPDATE — any authenticated user can edit any material
CREATE POLICY "Authenticated users can update raw_materials"
  ON raw_materials FOR UPDATE
  USING  (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 6. Global DELETE — any authenticated user can delete any material
CREATE POLICY "Authenticated users can delete raw_materials"
  ON raw_materials FOR DELETE
  USING (auth.role() = 'authenticated');

-- 7. Reload the PostgREST schema cache so the policy change takes effect
--    immediately without a service restart.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

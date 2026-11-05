-- ============================================================================
-- Migration 967: raw_materials, a user-owned write may not name an organization the caller is not a member of
-- ============================================================================
-- master_insert_own, master_update_own and master_delete_own (on the stage database; no file in this folder defines them) test
-- only user_id = auth.uid(). Combined with OR beside the org_* policies, a caller could insert or move a row of their own
-- into ANOTHER organization's catalog by setting organization_id to it. This adds the missing condition to each:
--   user_id = auth.uid() AND (organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids()))
-- A user still creates, edits and deletes their own rows, with no organization or in their own organization. The org_*
-- policies are untouched. Roles that bypass row-level security (service_role, the owner) are not affected by policies at all.
--
-- Schema only. Idempotent: ALTER POLICY is applied only where the policy exists, so a database that never had the master_*
-- policies is left exactly as it is, and re-running changes nothing further. Nothing is created here.
-- ============================================================================

DO $$
DECLARE
  own_row constant text :=
    'user_id = auth.uid() AND (organization_id IS NULL OR organization_id IN (SELECT public.current_user_org_ids()))';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'raw_materials' AND policyname = 'master_insert_own') THEN
    EXECUTE format('ALTER POLICY "master_insert_own" ON public.raw_materials WITH CHECK (%s)', own_row);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'raw_materials' AND policyname = 'master_update_own') THEN
    EXECUTE format('ALTER POLICY "master_update_own" ON public.raw_materials USING (%s) WITH CHECK (%s)', own_row, own_row);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'raw_materials' AND policyname = 'master_delete_own') THEN
    EXECUTE format('ALTER POLICY "master_delete_own" ON public.raw_materials USING (%s)', own_row);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 966: raw_materials, drop the legacy master_select_own_and_global SELECT policy
-- ============================================================================
-- raw_materials had two SELECT policies, combined with OR:
--   org_select_raw_materials          organization_id IS NULL OR a member of that organization     (migration 621, correct)
--   master_select_own_and_global      user_id = auth.uid() OR user_id IS NULL OR is_global           (not defined by any file in
--                                                                                                    this folder; it is on the stage database)
-- The second one makes a row with an organization but no user_id readable by every organization. Dropping it leaves 621's
-- rule: a row with an organization is visible only to members of that organization; a row with no organization (the shared
-- library of migration 349, including its user-stamped rows) stays visible to every signed-in user.
--
-- Schema only. Idempotent and safe on a database that never had the policy (DROP POLICY IF EXISTS does nothing there), which
-- is the case for any database built from this folder alone. Migration 544 drops the same name from mhr_records the same way.
-- ============================================================================

DROP POLICY IF EXISTS "master_select_own_and_global" ON public.raw_materials;

NOTIFY pgrst, 'reload schema';

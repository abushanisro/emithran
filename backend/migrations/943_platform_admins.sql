-- ============================================================================
-- Migration 943: platform administrators
-- ============================================================================
-- Global actions (refreshing the shared reference FX snapshots, reading the should-cost calibration history) belong to the
-- operators of the platform, not to any organization's admin. Who they are is kept here, in the database, and never in an Auth0
-- token claim: revoking someone is one DELETE and takes effect on their next request.
--
--   * No API role can read or write the table (row-level security on, no policies). An operator grants or revokes with SQL as the
--     database owner; the runbook is docs/CUTOVER_AUTH0_POSTGRES.md ("Platform administrators"). granted_by names the operator
--     who granted, so the grant itself is attributable.
--   * is_platform_admin(user) is the one way to ask. It answers only for the caller (auth.uid()), so a signed-in user cannot
--     probe who the platform admins are; the backend's AuthzGuard calls it with the caller's own database token.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.platform_admins IS
  'Operators allowed to run platform-wide (cross-organization) actions. Granted and revoked by SQL only; see is_platform_admin().';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_admins TO service_role;

-- Whether p_user_id is a platform admin, answered only when p_user_id is the caller. Another user's id is answered false.
CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user_id IS NOT NULL
     AND p_user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.platform_admins a WHERE a.user_id = p_user_id)
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;

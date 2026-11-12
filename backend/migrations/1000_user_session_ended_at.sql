-- ============================================================================
-- Migration 1000: logout ends the session on the server
-- ============================================================================
-- "Log out" (POST /api/v1/auth/session/end, then Auth0's logout) stamps ended_at on the session's row in user_session_activity
-- (migration 901). From then on RequestAuthGuard refuses that session (401 SESSION_ENDED), so a copied session cookie stops working
-- at once instead of when its access token expires. The row stays, as every row does (a deleted row would restart the idle clock).
--
-- Additive and nullable: the backend before this release never reads it. Run BEFORE deploying the backend that reads it.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE public.user_session_activity ADD COLUMN IF NOT EXISTS ended_at timestamptz;

COMMENT ON COLUMN public.user_session_activity.ended_at IS
  'When the session was signed out (logout). Set: every request with this session is refused.';

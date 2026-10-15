-- ============================================================================
-- Migration 901: per-session activity for the 30-minute inactivity timeout
-- ============================================================================
-- SupabaseAuthGuard rejects any request whose Supabase session has been idle
-- past its deadline, and revokes that session (session-activity.service.ts).
-- The rule lives in common/session/session-idle-policy.ts:
--
--   deadline = max(last_activity_at + 30 min,
--                  min(last_job_at + 2 min, last_activity_at + 45 min))
--
-- last_activity_at moves only on a real user-activity heartbeat
-- (POST /v1/api/auth/session/activity, kind 'user'); ordinary API traffic and
-- polling never move it. last_job_at moves while one of the protected CAD/BOM
-- flows is running (kind 'job'), which can extend the session by at most
-- 15 minutes past the idle deadline.
--
-- One row per Supabase session, keyed by the JWT's session_id claim.
-- Application code never deletes rows: a deleted row would give a still-live
-- idle session a fresh clock on its next request. Rows go only with their
-- session (ON DELETE CASCADE from auth.sessions) or their user. If this role
-- may not reference auth.sessions, that foreign key is skipped with a NOTICE;
-- enforcement is unchanged and rows of ended sessions simply remain (a few
-- dozen bytes per sign-in).
--
-- Service-only: RLS is on with no policies, and anon/authenticated have no
-- grants. Only the backend's privileged client reads or writes it.
--
-- Run BEFORE deploying the backend that reads it: in production a missing
-- table makes every authenticated request fail closed with 503.
--
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_session_activity (
  session_id       uuid PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_job_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

DO $m901$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_session_activity_session_id_fkey'
       AND conrelid = 'public.user_session_activity'::regclass
  ) THEN
    ALTER TABLE public.user_session_activity
      ADD CONSTRAINT user_session_activity_session_id_fkey
      FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Migration 901: cannot reference auth.sessions (%); rows of ended sessions will remain. Enforcement is unaffected.', SQLERRM;
END
$m901$;

CREATE INDEX IF NOT EXISTS user_session_activity_user_id_idx
  ON public.user_session_activity (user_id);

ALTER TABLE public.user_session_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_session_activity FROM anon, authenticated;

COMMENT ON TABLE public.user_session_activity IS
  'Last user activity per Supabase session, for the server-enforced 30-minute inactivity timeout. Service-only.';
COMMENT ON COLUMN public.user_session_activity.last_activity_at IS
  'Last user-activity heartbeat. API traffic and polling never move it.';
COMMENT ON COLUMN public.user_session_activity.last_job_at IS
  'Last heartbeat from a protected CAD/BOM flow in progress. Extends the session by at most 15 minutes past the idle deadline.';

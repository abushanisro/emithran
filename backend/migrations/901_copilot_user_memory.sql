-- ============================================================================
-- Migration 901: manufacturing copilot, per-user saved preferences
-- ============================================================================
-- One row per user holding the short preferences the user explicitly asked the
-- copilot to remember ("always show costs per 1000 parts"). Replaces the
-- copilot memory that lived in a temp folder of the CAD engine container and
-- was lost on every deploy.
--
-- Per-user, not per-organization: a preference is about how one person likes
-- answers, and it follows them across organizations. The backend never uses a
-- privileged client for this table, so row-level security is the only gate.
-- The service limits each entry to 200 characters; the 20-entry limit is also
-- enforced here.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.copilot_user_memory (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences text[] NOT NULL DEFAULT '{}' CHECK (cardinality(preferences) <= 20),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_select_copilot_user_memory ON public.copilot_user_memory;
CREATE POLICY own_select_copilot_user_memory ON public.copilot_user_memory FOR SELECT
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS own_insert_copilot_user_memory ON public.copilot_user_memory;
CREATE POLICY own_insert_copilot_user_memory ON public.copilot_user_memory FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS own_update_copilot_user_memory ON public.copilot_user_memory;
CREATE POLICY own_update_copilot_user_memory ON public.copilot_user_memory FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS own_delete_copilot_user_memory ON public.copilot_user_memory;
CREATE POLICY own_delete_copilot_user_memory ON public.copilot_user_memory FOR DELETE
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';

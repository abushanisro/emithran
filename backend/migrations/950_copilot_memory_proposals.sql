-- ============================================================================
-- Migration 950: copilot memory changes are proposed by the model and confirmed by the user
-- ============================================================================
-- Before: the copilot's update_preferences tool wrote copilot_user_memory directly. Text the model read (a part name, a warning)
-- could steer it into planting a durable preference; the only defence was a prompt rule and an intent check on the user's message.
--
-- Now update_preferences only stores a proposal here and writes nothing else. The user sees it in the copilot panel and presses
-- Save, which calls POST /copilot/memory/proposals/:id/confirm; only then does the backend change copilot_user_memory.
--   * A proposal belongs to one user, conversation and turn (the confirm call must name the same conversation and turn).
--   * It expires 10 minutes after it was made (the default below; a row can never be made to live longer).
--   * It is used once: confirming sets consumed_at, and the update policy only matches an unconsumed, unexpired row, so a
--     second confirm (or a concurrent one) changes nothing.
-- Row-level security is the only gate (the backend uses the user's own client): a user sees, creates and consumes only their own
-- proposals, and may delete their own (the backend removes spent ones when it makes a new one).
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.copilot_memory_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id    uuid NOT NULL,
  turn               integer NOT NULL CHECK (turn >= 1),
  add_preferences    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(add_preferences) <= 5),
  remove_preferences text[] NOT NULL DEFAULT '{}' CHECK (cardinality(remove_preferences) <= 5),
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at        timestamptz,
  CHECK (cardinality(add_preferences) + cardinality(remove_preferences) >= 1),
  CHECK (expires_at <= created_at + interval '10 minutes')
);
COMMENT ON TABLE public.copilot_memory_proposals IS
  'Copilot memory changes awaiting the user''s confirmation (single use, 10 minutes). Only a confirmed proposal changes copilot_user_memory.';
CREATE INDEX IF NOT EXISTS idx_copilot_memory_proposals_user ON public.copilot_memory_proposals (user_id, expires_at);

ALTER TABLE public.copilot_memory_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.copilot_memory_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.copilot_memory_proposals TO authenticated;
GRANT INSERT (conversation_id, turn, add_preferences, remove_preferences) ON public.copilot_memory_proposals TO authenticated;
GRANT UPDATE (consumed_at) ON public.copilot_memory_proposals TO authenticated;
GRANT ALL ON public.copilot_memory_proposals TO service_role;

DROP POLICY IF EXISTS copilot_memory_proposals_own_select ON public.copilot_memory_proposals;
CREATE POLICY copilot_memory_proposals_own_select ON public.copilot_memory_proposals FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS copilot_memory_proposals_own_insert ON public.copilot_memory_proposals;
CREATE POLICY copilot_memory_proposals_own_insert ON public.copilot_memory_proposals FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND consumed_at IS NULL);
DROP POLICY IF EXISTS copilot_memory_proposals_consume ON public.copilot_memory_proposals;
CREATE POLICY copilot_memory_proposals_consume ON public.copilot_memory_proposals FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (user_id = (SELECT auth.uid()) AND consumed_at IS NOT NULL);
DROP POLICY IF EXISTS copilot_memory_proposals_own_delete ON public.copilot_memory_proposals;
CREATE POLICY copilot_memory_proposals_own_delete ON public.copilot_memory_proposals FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';

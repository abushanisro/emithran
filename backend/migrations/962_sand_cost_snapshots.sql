-- ============================================================================
-- Migration 962: frozen, reviewed cost results of a sand-cast part (review gate and price snapshot, D183 / zip pack)
-- ============================================================================
-- A cost result changes whenever a rate, a machine, the reference data or the part's own values change. To rely on one, an engineer freezes it:
--   sand_cost_snapshots  one row per freeze of one BOM item: the cost summary exactly as it was computed (summary), what it was computed with
--                        (context: location, batch size, production life, the part's own plant values, the reference source version), a label,
--                        who froze it and when. A snapshot is never edited. A DIFFERENT member then approves or rejects it, with a note: only
--                        status, reviewed_by, reviewed_at and review_note may change, once, from 'submitted'. Nothing is deleted except with its BOM item.
-- Writes are made by the backend (service role) after it has checked, as the user, that the BOM item is theirs; users only read their
-- organization's rows. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sand_cost_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id     uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  label           text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 3 AND 120),
  summary         jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  context         jsonb NOT NULL CHECK (jsonb_typeof(context) = 'object'),
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_note     text CHECK (review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 3 AND 500),
  -- A reviewed snapshot says who reviewed it and why, and the reviewer is not the one who froze it.
  CONSTRAINT sand_cost_snapshots_review CHECK (
    (status = 'submitted' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL)
    OR (status <> 'submitted' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND reviewed_by <> created_by)
  )
);

CREATE INDEX IF NOT EXISTS sand_cost_snapshots_item ON public.sand_cost_snapshots (bom_item_id, created_at DESC);

-- A snapshot is frozen: the summary, context, label and who froze it never change, and a review is made once.
CREATE OR REPLACE FUNCTION public.sand_cost_snapshots_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.bom_item_id <> OLD.bom_item_id OR NEW.organization_id <> OLD.organization_id
     OR NEW.label <> OLD.label OR NEW.summary <> OLD.summary OR NEW.context <> OLD.context
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a cost snapshot is frozen: only its review can be recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'submitted' THEN
    RAISE EXCEPTION 'a cost snapshot is reviewed once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS sand_cost_snapshots_frozen ON public.sand_cost_snapshots;
CREATE TRIGGER sand_cost_snapshots_frozen BEFORE UPDATE ON public.sand_cost_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.sand_cost_snapshots_frozen();

ALTER TABLE public.sand_cost_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_sand_cost_snapshots ON public.sand_cost_snapshots;
CREATE POLICY org_select_sand_cost_snapshots ON public.sand_cost_snapshots FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

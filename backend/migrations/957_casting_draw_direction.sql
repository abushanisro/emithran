-- ============================================================================
-- Migration 957: the engineer's draw direction for a sand-cast part (design step S5)
-- ============================================================================
-- The casting worker chooses the draw axis itself (fewest hidden regions, then shallowest). An engineer who knows better can fix it
-- to x, y or z. That choice is data of its own, not a setting on the analysis:
--   casting_draw_directions  one row per BOM item that has an override: the axis, WHY (required), who and when. Removing the row
--                            returns the part to the automatic choice. Every change is also an audit event (the history).
--   casting_analyses.config  the configuration the analysis was run with ({"drawDirection": "auto" | "x" | "y" | "z"}); config_hash
--                            (955) is its digest, so an analysis with another axis is another row, never a rewrite, and the
--                            automatic analysis stays available.
-- Writes are made by the backend (service role) after it has checked, as the user, that the BOM item is theirs; users only read their
-- organization's rows. Idempotent.
-- ============================================================================

ALTER TABLE public.casting_analyses
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{"drawDirection":"auto"}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'casting_analyses_config_draw_direction') THEN
    ALTER TABLE public.casting_analyses
      ADD CONSTRAINT casting_analyses_config_draw_direction
      CHECK (coalesce(config->>'drawDirection', '') IN ('auto', 'x', 'y', 'z'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.casting_draw_directions (
  bom_item_id     uuid PRIMARY KEY REFERENCES public.bom_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  axis            text NOT NULL CHECK (axis IN ('x', 'y', 'z')),
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  set_by          uuid NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.casting_draw_directions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_casting_draw_directions ON public.casting_draw_directions;
CREATE POLICY org_select_casting_draw_directions ON public.casting_draw_directions FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

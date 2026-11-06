-- ============================================================================
-- Migration 968: the engineer's mold-opening (pull) axis for a plastic part
-- ============================================================================
-- The CAD engine chooses the pull direction itself (fewest undercut faces, then the largest projected area). An engineer who knows the
-- tool opens another way can fix it to x, y or z. That choice is data of its own:
--   plastic_pull_directions  one row per BOM item that has an override: the axis, WHY (required), who and when, and the 3D file it was
--                            chosen on (source_path). Removing the row returns the part to the automatic choice. Every change is also an
--                            audit event (the history).
-- It applies only while the item's 3D file is the one it was chosen on; after the file is replaced it is held back and the engineer is
-- asked to confirm or remove it (never silently kept on geometry it was not chosen for).
-- Writes are made by the backend (service role) after it has checked, as the user, that the BOM item is theirs; users only read their
-- organization's rows. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.plastic_pull_directions (
  bom_item_id     uuid PRIMARY KEY REFERENCES public.bom_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  axis            text NOT NULL CHECK (axis IN ('x', 'y', 'z')),
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  set_by          uuid NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  source_path     text
);

ALTER TABLE public.plastic_pull_directions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_plastic_pull_directions ON public.plastic_pull_directions;
CREATE POLICY org_select_plastic_pull_directions ON public.plastic_pull_directions FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

-- ============================================================================
-- Migration 961: a part's own value for a sand-casting plant variable (calculation explorer, D183 step 3)
-- ============================================================================
-- The plant variables of memory/Sand casting (machining_reference_data, category 'variable') are shared. An engineer who knows a part
-- needs another value (a yield, an allowance, a threshold) can set it for ONE BOM item:
--   sand_variable_overrides  one row per (BOM item, variable): the value as text (numeric or enum, as the variable is), WHY (required),
--                            who and when. Removing the row returns the part to the plant value. Every change is also an audit event.
-- The costing reads these rows as the user and lays them over the reference for that one calculation; the shared data is never edited.
-- Writes are made by the backend (service role) after it has checked, as the user, that the BOM item is theirs; users only read their
-- organization's rows. Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sand_variable_overrides (
  bom_item_id     uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  variable        text NOT NULL CHECK (variable ~ '^[A-Za-z][A-Za-z0-9_]{0,79}$'),
  organization_id uuid NOT NULL,
  value           text NOT NULL CHECK (char_length(btrim(value)) BETWEEN 1 AND 100),
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  set_by          uuid NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bom_item_id, variable)
);

ALTER TABLE public.sand_variable_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_sand_variable_overrides ON public.sand_variable_overrides;
CREATE POLICY org_select_sand_variable_overrides ON public.sand_variable_overrides FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

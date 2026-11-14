-- ============================================================================
-- Migration 1011: a part's own value for a field of a stored calculator
-- ============================================================================
-- A calculator-driven operation (an injection cycle: fill, pack, cooling, mold open and close) is computed by a shared, stored calculator. An engineer
-- who knows a part needs another value (a measured cooling time, a slower press) can set it for ONE BOM item:
--   calculator_field_overrides  one row per (BOM item, calculator, field): the value, WHY (required), who and when. An input's value replaces the one
--                               the engine seeds; a calculated field's value replaces the formula's result, and every later formula uses it. Removing the
--                               row returns the part to the calculator. Every change is also an audit event.
-- The costing reads these rows as the user and lays them over the calculators for that one calculation; the stored calculators are never edited.
-- Writes are made by the backend (service role) after it has checked, as the user, that the BOM item is theirs; users only read their
-- organization's rows. Same pattern as sand_variable_overrides (migration 961). Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.calculator_field_overrides (
  bom_item_id     uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  calculator_name text NOT NULL CHECK (char_length(btrim(calculator_name)) BETWEEN 1 AND 200),
  field_name      text NOT NULL CHECK (char_length(btrim(field_name)) BETWEEN 1 AND 200),
  organization_id uuid NOT NULL,
  value           numeric NOT NULL CHECK (value > 0),
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  set_by          uuid NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bom_item_id, calculator_name, field_name)
);

COMMENT ON TABLE public.calculator_field_overrides IS 'A part''s own value for a field of a stored calculator, with the reason; laid over the calculator for that part''s calculation only.';

ALTER TABLE public.calculator_field_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_calculator_field_overrides ON public.calculator_field_overrides;
CREATE POLICY org_select_calculator_field_overrides ON public.calculator_field_overrides FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

NOTIFY pgrst, 'reload schema';

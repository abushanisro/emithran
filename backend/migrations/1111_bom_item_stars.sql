-- ============================================================================
-- Migration 1111: starred BOM items, each person's own (as Gmail's stars)
-- ============================================================================
-- A star marks a BOM item for the person who set it: a teammate's stars are theirs, and a star changes nothing in the BOM.
--   * One row per (person, item); starring twice is the same row (the API upserts), unstarring deletes it.
--   * bom_id is stored with the row so one BOM's stars are read with one indexed filter; it must be the item's own BOM.
--   * Deleting the item or the BOM deletes its stars; deleting the person deletes theirs.
-- Row-level security is the only gate (the backend uses the person's own client): a person sees, adds and removes only their own
-- stars, and only on items they can see — the bom_items lookups below run under bom_items' own organisation policies.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bom_item_stars (
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  bom_item_id uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  bom_id      uuid NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, bom_item_id)
);
COMMENT ON TABLE public.bom_item_stars IS
  'BOM items a person starred (their own marks, as Gmail''s stars). Changes nothing in the BOM.';
CREATE INDEX IF NOT EXISTS idx_bom_item_stars_user_bom ON public.bom_item_stars (user_id, bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_stars_item ON public.bom_item_stars (bom_item_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_stars_bom ON public.bom_item_stars (bom_id);

ALTER TABLE public.bom_item_stars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bom_item_stars FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.bom_item_stars TO authenticated;
GRANT INSERT (bom_item_id, bom_id) ON public.bom_item_stars TO authenticated;
GRANT ALL ON public.bom_item_stars TO service_role;

DROP POLICY IF EXISTS bom_item_stars_own_select ON public.bom_item_stars;
CREATE POLICY bom_item_stars_own_select ON public.bom_item_stars FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.bom_items i WHERE i.id = bom_item_stars.bom_item_id)
  );
DROP POLICY IF EXISTS bom_item_stars_own_insert ON public.bom_item_stars;
CREATE POLICY bom_item_stars_own_insert ON public.bom_item_stars FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.bom_items i WHERE i.id = bom_item_stars.bom_item_id AND i.bom_id = bom_item_stars.bom_id)
  );
DROP POLICY IF EXISTS bom_item_stars_own_delete ON public.bom_item_stars;
CREATE POLICY bom_item_stars_own_delete ON public.bom_item_stars FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';

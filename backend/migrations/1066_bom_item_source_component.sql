-- ============================================================================
-- Migration 1066: a BOM item's source component (2-Model Machining)
-- ============================================================================
-- A 2-Model Machining part (memory/"2 Mold Molding", the factory's 2-Model Machining data) is machined from a source component: the
-- casting or forging blank, another item of the same BOM with its own CAD model and its own cost. The finished part's material is that
-- item's cost, and its CAD is compared with the finished part's to tell the faces left as supplied from those machined.
--
-- bom_items.source_item_id names that item. Integrity, enforced here so no client can store a link the engine cannot price:
--   - an item is not its own source;
--   - the source is an item of the same BOM;
--   - no cycle (a source cannot be machined, directly or through others, from the part it is the source of);
--   - deleting the source clears the link (the finished part is then not costed, and says why), it does not delete the part.
-- Row access is bom_items' own: the column adds no policy.
-- ============================================================================

ALTER TABLE public.bom_items
  ADD COLUMN IF NOT EXISTS source_item_id uuid REFERENCES public.bom_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bom_items.source_item_id IS
  '2-Model Machining: the item of the same BOM this part is machined from (its source component). Its cost is this part''s material.';

CREATE INDEX IF NOT EXISTS idx_bom_items_source_item_id ON public.bom_items (source_item_id) WHERE source_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.check_bom_item_source_component()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  source_bom uuid;
  cursor_id uuid;
  depth integer := 0;
BEGIN
  IF NEW.source_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.source_item_id = NEW.id THEN
    RAISE EXCEPTION 'a BOM item cannot be its own source component' USING ERRCODE = 'check_violation';
  END IF;
  SELECT bom_id INTO source_bom FROM public.bom_items WHERE id = NEW.source_item_id;
  IF NOT FOUND OR source_bom IS DISTINCT FROM NEW.bom_id THEN
    RAISE EXCEPTION 'the source component must be an item of the same BOM' USING ERRCODE = 'check_violation';
  END IF;
  -- Follow the source's own source, and its source, ...: reaching this part again is a cycle.
  cursor_id := NEW.source_item_id;
  WHILE cursor_id IS NOT NULL AND depth < 100 LOOP
    SELECT source_item_id INTO cursor_id FROM public.bom_items WHERE id = cursor_id;
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'a source component cannot be machined from the part it is the source of' USING ERRCODE = 'check_violation';
    END IF;
    depth := depth + 1;
  END LOOP;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_bom_items_source_component ON public.bom_items;
CREATE TRIGGER trg_bom_items_source_component
  BEFORE INSERT OR UPDATE OF source_item_id, bom_id ON public.bom_items
  FOR EACH ROW EXECUTE FUNCTION public.check_bom_item_source_component();

NOTIFY pgrst, 'reload schema';

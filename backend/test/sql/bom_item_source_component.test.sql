-- 1066: a 2-Model Machining part names the item of the same BOM it is machined from; the database refuses a link the engine cannot price.
INSERT INTO public.boms (id) VALUES ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
INSERT INTO public.bom_items (id, bom_id) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1'),  -- the casting
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1'),  -- the part machined from it
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000b1'),  -- a second operation on that part
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b2');  -- an item of another BOM

DO $$
DECLARE refused boolean;
BEGIN
  UPDATE bom_items SET source_item_id = '00000000-0000-0000-0000-000000000001' WHERE id = '00000000-0000-0000-0000-000000000002';
  UPDATE bom_items SET source_item_id = '00000000-0000-0000-0000-000000000002' WHERE id = '00000000-0000-0000-0000-000000000003';
  ASSERT (SELECT source_item_id FROM bom_items WHERE id = '00000000-0000-0000-0000-000000000003') = '00000000-0000-0000-0000-000000000002',
    'a part machined from an item of its own BOM is linked (and that item may itself be machined from another)';

  refused := false;
  BEGIN UPDATE bom_items SET source_item_id = id WHERE id = '00000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  ASSERT refused, 'an item is not its own source';

  refused := false;
  BEGIN UPDATE bom_items SET source_item_id = '00000000-0000-0000-0000-000000000009' WHERE id = '00000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  ASSERT refused, 'the source is an item of the same BOM';

  refused := false;
  BEGIN UPDATE bom_items SET source_item_id = '00000000-0000-0000-0000-000000000003' WHERE id = '00000000-0000-0000-0000-000000000001';
  EXCEPTION WHEN check_violation THEN refused := true; END;
  ASSERT refused, 'no cycle: the casting cannot be machined from a part made from it';

  DELETE FROM bom_items WHERE id = '00000000-0000-0000-0000-000000000001';
  ASSERT (SELECT source_item_id FROM bom_items WHERE id = '00000000-0000-0000-0000-000000000002') IS NULL,
    'deleting the source clears the link and keeps the part';
END $$;

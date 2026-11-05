-- 968: the engineer's pull axis of a plastic part is stored with its reason; users read their own organization's rows only and change nothing.
INSERT INTO public.bom_items (id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.plastic_pull_directions (bom_item_id, organization_id, axis, reason, set_by, source_path) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'y', 'tool opens along Y', '00000000-0000-0000-0000-0000000000c1', 'a.step'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', 'z', 'foundry practice', '00000000-0000-0000-0000-0000000000c2', 'b.step');

DO $$
BEGIN
  BEGIN
    UPDATE public.plastic_pull_directions SET axis = 'w' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000f1';
    ASSERT false, 'an axis other than x, y, z must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.plastic_pull_directions SET reason = '  ' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000f1';
    ASSERT false, 'a blank reason must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.plastic_pull_directions (bom_item_id, organization_id, axis, reason, set_by)
    VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'x', 'again', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a second pull direction for one BOM item must be refused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END
$$;

SET ROLE authenticated;
SET test.org_ids = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.plastic_pull_directions;
  ASSERT n = 1, 'a user sees the pull directions of their own organization only';
  BEGIN
    INSERT INTO public.plastic_pull_directions (bom_item_id, organization_id, axis, reason, set_by)
    VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'x', 'nope', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a user cannot insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.plastic_pull_directions SET axis = 'x';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.plastic_pull_directions;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.bom_items WHERE id = '00000000-0000-0000-0000-0000000000f3';
  SELECT count(*) INTO n FROM public.plastic_pull_directions WHERE bom_item_id = '00000000-0000-0000-0000-0000000000f3';
  ASSERT n = 0, 'the pull direction goes with its BOM item';
END
$$;

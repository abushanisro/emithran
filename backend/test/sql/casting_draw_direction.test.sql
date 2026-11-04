-- 957: an engineer's draw direction is stored with its reason; an analysis carries the configuration it ran with; users read their own
-- organization's directions only and change nothing.
INSERT INTO public.bom_items (id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.casting_draw_directions (bom_item_id, organization_id, axis, reason, set_by) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'y', 'the pattern is split along the long side', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 'z', 'foundry practice', '00000000-0000-0000-0000-0000000000c2');

DO $$
DECLARE cfg jsonb;
BEGIN
  -- an analysis row made before 957 (or without a configuration) is the automatic one
  INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.13.0', 1, 'h-auto');
  SELECT config INTO cfg FROM public.casting_analyses WHERE config_hash = 'h-auto';
  ASSERT cfg = '{"drawDirection":"auto"}'::jsonb, 'an analysis without a configuration is the automatic one';
  -- another axis is another analysis of the same file
  INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash, config)
  VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.13.0', 1, 'h-y', '{"drawDirection":"y"}');
  BEGIN
    INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash, config)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.13.0', 1, 'h-w', '{"drawDirection":"w"}');
    ASSERT false, 'an unknown draw direction in a configuration must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash, config)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.13.0', 1, 'h-none', '{}');
    ASSERT false, 'a configuration without a draw direction must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

DO $$
BEGIN
  -- the axis is x, y or z, and the reason is required
  BEGIN
    UPDATE public.casting_draw_directions SET axis = 'auto' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000d1';
    ASSERT false, 'auto is not an override: remove the row instead';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.casting_draw_directions SET reason = '  ' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000d1';
    ASSERT false, 'a blank reason must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.casting_draw_directions SET reason = repeat('x', 501) WHERE bom_item_id = '00000000-0000-0000-0000-0000000000d1';
    ASSERT false, 'a reason over 500 characters must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- one override per BOM item
  BEGIN
    INSERT INTO public.casting_draw_directions (bom_item_id, organization_id, axis, reason, set_by)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'x', 'again', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a second override for one BOM item must be refused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END
$$;

SET ROLE authenticated;
SET test.org_ids = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.casting_draw_directions;
  ASSERT n = 1, 'a user sees the directions of their own organization only';
  BEGIN
    INSERT INTO public.casting_draw_directions (bom_item_id, organization_id, axis, reason, set_by)
    VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'x', 'nope', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a user cannot insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.casting_draw_directions SET axis = 'x';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.casting_draw_directions;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- removing the BOM item removes its direction
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.bom_items WHERE id = '00000000-0000-0000-0000-0000000000d3';
  SELECT count(*) INTO n FROM public.casting_draw_directions WHERE bom_item_id = '00000000-0000-0000-0000-0000000000d3';
  ASSERT n = 0, 'a direction goes with its BOM item';
END
$$;

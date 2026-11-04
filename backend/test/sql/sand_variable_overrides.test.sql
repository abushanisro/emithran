-- 961: a part's own value for a sand plant variable is stored with its reason; users read their own organization's rows only and change nothing.
INSERT INTO public.bom_items (id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.sand_variable_overrides (bom_item_id, variable, organization_id, value, reason, set_by) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'finishAllowance', '00000000-0000-0000-0000-0000000000a1', '0.8', 'rough sand surface on this part', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000e3', 'finishAllowance', '00000000-0000-0000-0000-0000000000a2', '0.4', 'foundry practice', '00000000-0000-0000-0000-0000000000c2');

DO $$
BEGIN
  -- the reason is required, the value is not empty, the variable has a plain name
  BEGIN
    UPDATE public.sand_variable_overrides SET reason = '  ' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000e1';
    ASSERT false, 'a blank reason must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_variable_overrides SET value = ' ' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000e1';
    ASSERT false, 'a blank value must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_variable_overrides SET variable = 'a b; drop' WHERE bom_item_id = '00000000-0000-0000-0000-0000000000e1';
    ASSERT false, 'a variable name with spaces or punctuation must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- one value per variable per BOM item, but another variable is another row
  BEGIN
    INSERT INTO public.sand_variable_overrides (bom_item_id, variable, organization_id, value, reason, set_by)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'finishAllowance', '00000000-0000-0000-0000-0000000000a1', '1', 'again', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a second value for one variable of one BOM item must be refused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.sand_variable_overrides (bom_item_id, variable, organization_id, value, reason, set_by)
  VALUES ('00000000-0000-0000-0000-0000000000e1', 'partPatternAllowance', '00000000-0000-0000-0000-0000000000a1', '30', 'larger pattern allowance', '00000000-0000-0000-0000-0000000000c1');
END
$$;

SET ROLE authenticated;
SET test.org_ids = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.sand_variable_overrides;
  ASSERT n = 2, 'a user sees the overrides of their own organization only';
  BEGIN
    INSERT INTO public.sand_variable_overrides (bom_item_id, variable, organization_id, value, reason, set_by)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'highEndThickness', '00000000-0000-0000-0000-0000000000a1', '1', 'nope', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a user cannot insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.sand_variable_overrides SET value = '9';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.sand_variable_overrides;
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

-- removing the BOM item removes its overrides
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.bom_items WHERE id = '00000000-0000-0000-0000-0000000000e3';
  SELECT count(*) INTO n FROM public.sand_variable_overrides WHERE bom_item_id = '00000000-0000-0000-0000-0000000000e3';
  ASSERT n = 0, 'overrides go with their BOM item';
END
$$;

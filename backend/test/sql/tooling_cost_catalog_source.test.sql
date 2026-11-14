-- 1015: a tooling record keeps its process, sub-process and the catalog row it was priced from; a catalog item is never custom.
INSERT INTO public.tooling_cost_records (id, manufacturing_process, sub_process, catalog_source, is_custom) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'injection_molding', NULL, '2026-Plastic:cmStandardToolingComponents:0', false),
  ('00000000-0000-0000-0000-0000000000e2', 'machining', 'Gun Drilling', NULL, true),
  ('00000000-0000-0000-0000-0000000000e3', NULL, NULL, NULL, false);

DO $$
BEGIN
  ASSERT (SELECT catalog_source FROM public.tooling_cost_records WHERE id = '00000000-0000-0000-0000-0000000000e1') = '2026-Plastic:cmStandardToolingComponents:0',
    'the catalog source is kept';
  BEGIN
    INSERT INTO public.tooling_cost_records (manufacturing_process, catalog_source, is_custom) VALUES ('injection_molding', 'Air Poppet', false);
    ASSERT false, 'a catalog source that is not dataset:table:row must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tooling_cost_records (manufacturing_process, catalog_source, is_custom) VALUES ('injection_molding', '2026-Plastic:cmStandardToolingComponents:1', true);
    ASSERT false, 'a row cannot be both a catalog item and custom';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tooling_cost_records (manufacturing_process) VALUES ('  ');
    ASSERT false, 'a blank process must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

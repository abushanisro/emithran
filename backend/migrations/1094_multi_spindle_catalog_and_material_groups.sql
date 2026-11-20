-- ============================================================================
-- Migration 1094: Multi-Spindle Machining's catalog and material groups
-- ============================================================================
-- Multi-Spindle Machining is costed (user decision 2026-11-20): a turned part machined from bar on a CNC multi-spindle (6 or 8 spindles) or a
-- twin-spindle turning center, the Simultaneous Turning machines of memory/Machining (HR Rates class simultaneous_turning, migrations 738,
-- 788, 829, 1093). memory/Multi-Spindle Maching holds the bar stock half of the process group (Material Stock, staged as 2026-Multi-Spindle by
-- migrations 784, 786 and 787); its catalog had only that row (migration 862, inactive), so nothing of the process group could be linked to
-- the machining it is made by, and the material picker listed every material ("no material groups are linked").
--
--   1. A Multi-Spindle Machining > Simultaneous Turning row in process_taxonomy and process_calculator_mappings, on machine class
--      simultaneous_turning (default machine as memory/Machining/processes.csv names it). Migration 1095 links the cycle calculator to it and
--      activates it. The Material Stock row stays as it is (non_mfg, the bought bar): the bar stock calculator is a helper that prices it.
--   2. process_material_groups: the process group draws on Machining's material groups (Machining, Ferrous & Non-Ferrous; migration 879), as
--      2-Model Machining does (1067): the bar prices of memory/Multi-Spindle Maching (material_stock_prices, migration 857) are for them.
--
-- Idempotent. Writes inside DO blocks; listed in REFERENCE_DATA.json to be seen.
-- Verify: SELECT process_group, process_route, operation, machine_class, is_active FROM process_calculator_mappings
--           WHERE process_group = 'Multi-Spindle Machining';
-- ============================================================================

DO $ms_catalog$
DECLARE v_process uuid;
BEGIN
  INSERT INTO public.process_taxonomy (process_group, process_name, machine_class, roadmap_status, default_machine_name, display_order, notes)
  VALUES ('Multi-Spindle Machining', 'Simultaneous Turning', 'simultaneous_turning', 'not_modeled', 'Virtual CNC Multi-Spindle, 6 Spindles, Large', 4210,
          'The turning of a Multi-Spindle Machining part on a CNC multi-spindle or twin-spindle turning center (memory/Machining Simultaneous Turning).')
  ON CONFLICT (process_group, process_name) DO NOTHING;

  SELECT id INTO v_process FROM public.process_taxonomy WHERE process_group = 'Multi-Spindle Machining' AND process_name = 'Simultaneous Turning';

  INSERT INTO public.process_calculator_mappings (process_group, process_route, operation, machine_class, canonical_process_id, is_active, display_order)
  SELECT 'Multi-Spindle Machining', 'Simultaneous Turning', 'Simultaneous Turning', 'simultaneous_turning', v_process, false, 4210
  WHERE NOT EXISTS (
    SELECT 1 FROM public.process_calculator_mappings
     WHERE process_group = 'Multi-Spindle Machining' AND process_route = 'Simultaneous Turning' AND operation = 'Simultaneous Turning'
  );
END $ms_catalog$;

DO $ms_material_groups$
BEGIN
  -- Absent only in a stripped-down database (the local data stub): nothing to link there.
  IF to_regclass('public.process_material_groups') IS NULL THEN RETURN; END IF;
  INSERT INTO public.process_material_groups (process_group, material_group)
  SELECT 'Multi-Spindle Machining', g.material_group FROM public.process_material_groups g
   WHERE g.process_group = 'Machining'
     AND NOT EXISTS (SELECT 1 FROM public.process_material_groups x WHERE x.process_group = 'Multi-Spindle Machining' AND x.material_group = g.material_group);
  IF NOT EXISTS (SELECT 1 FROM public.process_material_groups WHERE process_group = 'Multi-Spindle Machining') THEN
    RAISE EXCEPTION 'Multi-Spindle Machining: Machining has no material groups to share (migration 879)';
  END IF;
END $ms_material_groups$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 1087: Assembly Plastic Molding's catalog link and materials
-- ============================================================================
-- Multi-Shot Molding is injection molding into each stage of a multi-shot mold (the same fill, pack, cool and eject per shot): its catalog
-- row computes with the injection cycle-time calculator (migration 975), run once per shot with that shot's material, and is active. (Pick
-- and Place is linked and activated by migration 1086 with its own calculator.) Assembly Plastic Molding molds the plastics Plastic Molding
-- does (process_material_groups, migration 879), so the Process picker offers it for a plastic grade. Its machines and their press
-- attributes are migration 1085's.
-- Idempotent.
-- ============================================================================

DO $link$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.calculators WHERE name = 'Injection Molding - Cycle Time' AND user_id IS NULL AND retired_at IS NULL;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'migration 1087: the injection cycle-time calculator (migration 975) is missing';
  END IF;
  UPDATE public.process_calculator_mappings
  SET calculator_id = v_id, calculator_name = 'Injection Molding - Cycle Time', is_active = true
  WHERE process_group = 'Assembly Plastic Molding' AND operation = 'Multi-Shot Molding';
END
$link$;

-- process_material_groups is migration 879's; a database without it (a local stub) has nothing to link.
DO $materials$
BEGIN
  IF to_regclass('public.process_material_groups') IS NOT NULL THEN
    INSERT INTO public.process_material_groups (process_group, material_group)
    SELECT 'Assembly Plastic Molding', 'Plastic & Rubber'
    WHERE NOT EXISTS (SELECT 1 FROM public.process_material_groups WHERE process_group = 'Assembly Plastic Molding' AND material_group = 'Plastic & Rubber');
  END IF;
END
$materials$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 1067: the 2-Model Machining process group, under its own name
-- ============================================================================
-- Root cause: migration 862 seeded the process catalog from the memory/ folder names, and memory/"2 Mold Molding" is the factory's
-- 2-Model Machining data under a mislabelled folder: digital_factory_tree.csv lists the folder "2-Model Machining", and its variables
-- say "...source model cost for material cost in 2-Model Machining". Migration 790 had declined to seed it for that reason ("no
-- confirmed group"); 862 seeded it anyway, so the Process dropdown offered "2 Mold Molding", a process no one knows, never costed.
--
-- The group is renamed where it is stored: the catalog (process_taxonomy, process_calculator_mappings; its operations follow by
-- canonical_process_id) and the Process a part was already given (bom_items.scenario_overrides.processGroup). A 2-Model part is machined:
-- its material grade is chosen among the Machining material groups (process_material_groups), the same as a machined part's.
-- ============================================================================

-- A leftover placeholder of the same name (migration 302's 'General' row) would collide with the renamed catalog row: the catalog's wins.
DELETE FROM process_calculator_mappings
WHERE process_group = '2-Model Machining' AND process_route = 'General'
  AND EXISTS (SELECT 1 FROM process_calculator_mappings m WHERE m.process_group = '2 Mold Molding');

UPDATE process_taxonomy SET process_group = '2-Model Machining' WHERE process_group = '2 Mold Molding';
UPDATE process_calculator_mappings SET process_group = '2-Model Machining', updated_at = now() WHERE process_group = '2 Mold Molding';

-- Guarded (here and below): the local-data test stub lacks some of these tables and columns; every real database has them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'bom_items' AND column_name = 'scenario_overrides') THEN
    RETURN;
  END IF;
  UPDATE bom_items
  SET scenario_overrides = jsonb_set(scenario_overrides, '{processGroup}', '"2-Model Machining"'::jsonb)
  WHERE scenario_overrides->>'processGroup' = '2 Mold Molding';
END $$;

DO $$
BEGIN
  IF to_regclass('public.process_material_groups') IS NULL THEN RETURN; END IF;  -- absent from the local-data test stub
  INSERT INTO process_material_groups (process_group, material_group)
  SELECT '2-Model Machining', material_group FROM process_material_groups WHERE process_group = 'Machining'
  ON CONFLICT DO NOTHING;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Migration 1107: Roto & Blow Molding's material group
-- ============================================================================
-- Roto & Blow Molding is costed (user decision 2026-11-21): a blow molded or rotomolded part is priced by costing/roto-blow from its own 72
-- materials (raw_materials material_group 'Roto & Blow Molding', migration 855; whether each is blow molded or rotomolded, and its melt
-- properties, in raw_material_properties). process_material_groups had no row for the process group, so the material picker of a Roto &
-- Blow Molding part listed every material.
--
-- process_material_groups: Roto & Blow Molding draws on its own material group.
--
-- Idempotent. Writes inside a DO block; listed in REFERENCE_DATA.json to be seen.
-- Verify: SELECT * FROM process_material_groups WHERE process_group = 'Roto & Blow Molding';   -- one row
-- ============================================================================

DO $rb_material_group$
BEGIN
  -- Absent only in a stripped-down database (the local data stub): nothing to link there.
  IF to_regclass('public.process_material_groups') IS NULL THEN RETURN; END IF;
  INSERT INTO public.process_material_groups (process_group, material_group)
  SELECT 'Roto & Blow Molding', 'Roto & Blow Molding'
   WHERE NOT EXISTS (SELECT 1 FROM public.process_material_groups WHERE process_group = 'Roto & Blow Molding' AND material_group = 'Roto & Blow Molding');
  IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE material_group = 'Roto & Blow Molding') THEN
    RAISE EXCEPTION 'Roto & Blow Molding: raw_materials holds none of its materials (migration 855)';
  END IF;
END $rb_material_group$;

NOTIFY pgrst, 'reload schema';

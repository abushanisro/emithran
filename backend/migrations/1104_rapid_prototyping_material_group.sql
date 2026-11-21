-- ============================================================================
-- Migration 1104: Rapid Prototyping's material group
-- ============================================================================
-- Rapid Prototyping is costed (user decision 2026-11-21): a part whose Process is Rapid Prototyping is priced by the additive engine in its
-- own domain (costing/additive/additive-domain.ts RAPID_PROTOTYPING), from its own 50 materials (raw_materials material_group 'Rapid
-- Prototyping', migration 855; each tagged SLS, SLA or 3D Printing in raw_material_properties 'process'). process_material_groups had no
-- row for the process group, so the material picker of a Rapid Prototyping part listed every material ("no material groups are linked")
-- and a grade picked from another catalog was priced as the closest Rapid Prototyping material only after the fact.
--
-- process_material_groups: Rapid Prototyping draws on its own material group.
--
-- Idempotent. Writes inside a DO block; listed in REFERENCE_DATA.json to be seen.
-- Verify: SELECT * FROM process_material_groups WHERE process_group = 'Rapid Prototyping';   -- one row
-- ============================================================================

DO $rp_material_group$
BEGIN
  -- Absent only in a stripped-down database (the local data stub): nothing to link there.
  IF to_regclass('public.process_material_groups') IS NULL THEN RETURN; END IF;
  INSERT INTO public.process_material_groups (process_group, material_group)
  SELECT 'Rapid Prototyping', 'Rapid Prototyping'
   WHERE NOT EXISTS (SELECT 1 FROM public.process_material_groups WHERE process_group = 'Rapid Prototyping' AND material_group = 'Rapid Prototyping');
  IF NOT EXISTS (SELECT 1 FROM public.raw_materials WHERE material_group = 'Rapid Prototyping') THEN
    RAISE EXCEPTION 'Rapid Prototyping: raw_materials holds none of its materials (migration 855)';
  END IF;
END $rp_material_group$;

NOTIFY pgrst, 'reload schema';

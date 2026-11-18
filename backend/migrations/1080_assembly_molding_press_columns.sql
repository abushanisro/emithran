-- ============================================================================
-- Migration 1080: the insert molding presses' press columns, and Assembly Molding's catalog link and materials
-- ============================================================================
-- Insert Injection Molding is injection molding on an insert press (the same fill, pack, cool and eject): the injection engine sizes and
-- times a press from its typed columns (max_tonnage, shot_capacity_grams, press_cycle_time_s, mold heights, tie bars), as migration 633
-- filled them for the injection presses. Migration 862 seeded the insert presses with those values in specs only, so no insert press could
-- be checked for clamp or shot, or timed.
--
-- 1. The typed columns from the press's own specs (memory/Assembly molding/Machines/machines_insert_injection_molding.csv), USA and India
--    (migration 1079), only where empty:
--      max_tonnage          = clamping_force_kn / 9.80665 (metric tonnes; the injection presses' own: Kawaguchi KM140 1395 kN = 142.25 t)
--      shot_capacity_grams  = shot_size_g (GPPS grams, the injection presses' unit: densityPolystyreneForShotSize defines it)
--      press_cycle_time_s   = dry_cycle_time_s (the Euromap 6 dry cycle)
--      min/max_mold_height_mm, tie_bar_x_mm / tie_bar_y_mm (horizontal / vertical) where the file gives them
-- 2. The Insert Injection Molding catalog row computes with the injection cycle-time calculator (migration 975, the same physics), and is
--    active. (Insert Pick and Place is linked and activated by migration 1081 with its own calculator.)
-- 3. Assembly Molding molds the plastics Plastic Molding does (process_material_groups, migration 879), so the Process picker offers it for
--    a plastic grade.
-- Idempotent.
-- ============================================================================

UPDATE public.mhr_records SET
  max_tonnage         = COALESCE(max_tonnage, ROUND(((specs->>'clamping_force_kn')::numeric / 9.80665), 2)),
  shot_capacity_grams = COALESCE(shot_capacity_grams, ROUND((specs->>'shot_size_g')::numeric)::integer),
  press_cycle_time_s  = COALESCE(press_cycle_time_s, (specs->>'dry_cycle_time_s')::numeric),
  min_mold_height_mm  = COALESCE(min_mold_height_mm, ROUND((specs->>'min_mold_height_mm')::numeric)::integer),
  max_mold_height_mm  = COALESCE(max_mold_height_mm, ROUND((specs->>'max_mold_height_mm')::numeric)::integer),
  tie_bar_x_mm        = COALESCE(tie_bar_x_mm, ROUND(NULLIF(specs->>'tie_bar_distance_hor_mm', '')::numeric)::integer),
  tie_bar_y_mm        = COALESCE(tie_bar_y_mm, ROUND(NULLIF(specs->>'tie_bar_distance_vert_mm', '')::numeric)::integer),
  updated_at          = now()
WHERE machine_class = 'assembly_molding_insert_injection_molding'
  AND specs ? 'clamping_force_kn' AND specs ? 'shot_size_g' AND specs ? 'dry_cycle_time_s';

DO $link$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.calculators WHERE name = 'Injection Molding - Cycle Time' AND user_id IS NULL AND retired_at IS NULL;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'migration 1080: the injection cycle-time calculator (migration 975) is missing';
  END IF;
  UPDATE public.process_calculator_mappings
  SET calculator_id = v_id, calculator_name = 'Injection Molding - Cycle Time', is_active = true
  WHERE process_group = 'Assembly Molding' AND operation = 'Insert Injection Molding';
END
$link$;

-- process_material_groups is migration 879's; a database without it (a local stub) has nothing to link.
DO $materials$
BEGIN
  IF to_regclass('public.process_material_groups') IS NOT NULL THEN
    INSERT INTO public.process_material_groups (process_group, material_group)
    SELECT 'Assembly Molding', 'Plastic & Rubber'
    WHERE NOT EXISTS (SELECT 1 FROM public.process_material_groups WHERE process_group = 'Assembly Molding' AND material_group = 'Plastic & Rubber');
  END IF;
END
$materials$;

NOTIFY pgrst, 'reload schema';

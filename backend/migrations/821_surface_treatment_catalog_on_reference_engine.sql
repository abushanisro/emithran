-- ============================================================================
-- Migration 821: Surface Treatment catalog on the reference engine; retire
-- surface_treatment_rates
-- ============================================================================
-- Surface treatment is now costed only from memory/SurfaceTreatment
-- (migrations 819 reference data, 820 machines) by the surface-treatment
-- engine (backend costing/surface/surface-treatment-engine.ts). The drawing
-- callout is matched to a reference process and costed on its reference model.
--
-- The catalog still described the old model: migration 791 wired 16 Surface
-- Treatment rows to one generic machine_class surface_treatment, copied the
-- per-m2 "Surface Treatment" calculator onto them and marked them production,
-- because a rate row existed in surface_treatment_rates (migrations 362/363/
-- 490 -- not from memory/). Nothing reads that table or calculator any more.
--
-- This migration:
--   1. Points every Surface Treatment process_taxonomy row at its own reference
--      machine class (surface_<process>, the classes migration 820 seeds) and
--      sets roadmap_status from what the engine can actually cost:
--      production for the 18 processes the reference defines a time or price
--      for, not_modeled for the 15 it does not (Anodize: no anodizing
--      duration; Passivation: no parts-per-load rule; ...). The list below is
--      checked against the engine SURFACE_MODELED_PROCESSES by a backend test.
--   2. Same for process_calculator_mappings: machine_class, is_active =
--      modeled, and the per-m2 calculator link removed (calculator_id and
--      calculator_name NULL -- migration 790 already inserts rows that way).
--   3. Drops surface_treatment_rates.
--
-- One DO block plus one DROP; run each statement on its own.
-- ============================================================================

DO $st821$
DECLARE
  n_tax integer;
  n_map integer;
BEGIN
  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Anodize$str$, $str$surface_anodize$str$, false),
    ($str$Bead Blast$str$, $str$surface_bead_blast$str$, true),
    ($str$Black Oxide$str$, $str$surface_black_oxide$str$, false),
    ($str$Cadmium Plating$str$, $str$surface_cadmium_plating$str$, true),
    ($str$Conveyor Abrasive Finishing$str$, $str$surface_conveyor_abrasive_finishing$str$, true),
    ($str$Conveyor Conversion Coating$str$, $str$surface_conveyor_conversion_coating$str$, false),
    ($str$Conveyor Dry$str$, $str$surface_conveyor_dry$str$, true),
    ($str$Conveyor Oven Cure$str$, $str$surface_conveyor_oven_cure$str$, false),
    ($str$Conveyor Part Loading$str$, $str$surface_conveyor_part_loading$str$, true),
    ($str$Conveyor Part Unloading$str$, $str$surface_conveyor_part_unloading$str$, true),
    ($str$Conveyor Powder Coating$str$, $str$surface_conveyor_powder_coating$str$, false),
    ($str$Conveyor Shot Blast$str$, $str$surface_conveyor_shot_blast$str$, true),
    ($str$Decorative Chrome Plating$str$, $str$surface_decorative_chrome_plating$str$, true),
    ($str$Degrease$str$, $str$surface_degrease$str$, false),
    ($str$Dot Peen$str$, $str$surface_dot_peen$str$, true),
    ($str$Hard Chrome Plating$str$, $str$surface_hard_chrome_plating$str$, true),
    ($str$Laser Engraving$str$, $str$surface_laser_engraving$str$, true),
    ($str$Manual Paint$str$, $str$surface_manual_paint$str$, true),
    ($str$Mask-Bench$str$, $str$surface_mask_bench$str$, false),
    ($str$Mask-Spray$str$, $str$surface_mask_spray$str$, false),
    ($str$Nickel Plating$str$, $str$surface_nickel_plating$str$, true),
    ($str$Oven Cure$str$, $str$surface_oven_cure$str$, false),
    ($str$Painting$str$, $str$surface_painting$str$, true),
    ($str$Passivation$str$, $str$surface_passivation$str$, false),
    ($str$Powder Coat Cart$str$, $str$surface_powder_coat_cart$str$, false),
    ($str$Sand Blast$str$, $str$surface_sand_blast$str$, true),
    ($str$Screen Printing$str$, $str$surface_screen_printing$str$, false),
    ($str$Shot Blast$str$, $str$surface_shot_blast$str$, false),
    ($str$Shot Peen$str$, $str$surface_shot_peen$str$, true),
    ($str$Vibratory Finishing$str$, $str$surface_vibratory_finishing$str$, false),
    ($str$Wet Coat Line$str$, $str$surface_wet_coat_line$str$, false),
    ($str$Zinc Nickel Plating$str$, $str$surface_zinc_nickel_plating$str$, true),
    ($str$Zinc Plating$str$, $str$surface_zinc_plating$str$, true)
  )
  UPDATE process_taxonomy pt
  SET machine_class  = ref.machine_class,
      roadmap_status = CASE WHEN ref.modeled THEN 'production' ELSE 'not_modeled' END
  FROM ref
  WHERE pt.process_group = 'Surface Treatment'
    AND pt.process_name = ref.process_name;
  GET DIAGNOSTICS n_tax = ROW_COUNT;

  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Anodize$str$, $str$surface_anodize$str$, false),
    ($str$Bead Blast$str$, $str$surface_bead_blast$str$, true),
    ($str$Black Oxide$str$, $str$surface_black_oxide$str$, false),
    ($str$Cadmium Plating$str$, $str$surface_cadmium_plating$str$, true),
    ($str$Conveyor Abrasive Finishing$str$, $str$surface_conveyor_abrasive_finishing$str$, true),
    ($str$Conveyor Conversion Coating$str$, $str$surface_conveyor_conversion_coating$str$, false),
    ($str$Conveyor Dry$str$, $str$surface_conveyor_dry$str$, true),
    ($str$Conveyor Oven Cure$str$, $str$surface_conveyor_oven_cure$str$, false),
    ($str$Conveyor Part Loading$str$, $str$surface_conveyor_part_loading$str$, true),
    ($str$Conveyor Part Unloading$str$, $str$surface_conveyor_part_unloading$str$, true),
    ($str$Conveyor Powder Coating$str$, $str$surface_conveyor_powder_coating$str$, false),
    ($str$Conveyor Shot Blast$str$, $str$surface_conveyor_shot_blast$str$, true),
    ($str$Decorative Chrome Plating$str$, $str$surface_decorative_chrome_plating$str$, true),
    ($str$Degrease$str$, $str$surface_degrease$str$, false),
    ($str$Dot Peen$str$, $str$surface_dot_peen$str$, true),
    ($str$Hard Chrome Plating$str$, $str$surface_hard_chrome_plating$str$, true),
    ($str$Laser Engraving$str$, $str$surface_laser_engraving$str$, true),
    ($str$Manual Paint$str$, $str$surface_manual_paint$str$, true),
    ($str$Mask-Bench$str$, $str$surface_mask_bench$str$, false),
    ($str$Mask-Spray$str$, $str$surface_mask_spray$str$, false),
    ($str$Nickel Plating$str$, $str$surface_nickel_plating$str$, true),
    ($str$Oven Cure$str$, $str$surface_oven_cure$str$, false),
    ($str$Painting$str$, $str$surface_painting$str$, true),
    ($str$Passivation$str$, $str$surface_passivation$str$, false),
    ($str$Powder Coat Cart$str$, $str$surface_powder_coat_cart$str$, false),
    ($str$Sand Blast$str$, $str$surface_sand_blast$str$, true),
    ($str$Screen Printing$str$, $str$surface_screen_printing$str$, false),
    ($str$Shot Blast$str$, $str$surface_shot_blast$str$, false),
    ($str$Shot Peen$str$, $str$surface_shot_peen$str$, true),
    ($str$Vibratory Finishing$str$, $str$surface_vibratory_finishing$str$, false),
    ($str$Wet Coat Line$str$, $str$surface_wet_coat_line$str$, false),
    ($str$Zinc Nickel Plating$str$, $str$surface_zinc_nickel_plating$str$, true),
    ($str$Zinc Plating$str$, $str$surface_zinc_plating$str$, true)
  )
  UPDATE process_calculator_mappings pcm
  SET machine_class   = ref.machine_class,
      is_active       = ref.modeled,
      calculator_id   = NULL,
      calculator_name = NULL,
      updated_at      = now()
  FROM ref
  WHERE pcm.process_group = 'Surface Treatment'
    AND pcm.operation = ref.process_name;
  GET DIAGNOSTICS n_map = ROW_COUNT;

  RAISE NOTICE 'Surface Treatment: % process_taxonomy rows, % process_calculator_mappings rows re-pointed', n_tax, n_map;
END
$st821$;

DROP TABLE IF EXISTS surface_treatment_rates;

NOTIFY pgrst, 'reload schema';

-- Verify:
-- SELECT process_name, machine_class, roadmap_status FROM process_taxonomy
-- WHERE process_group = 'Surface Treatment' ORDER BY 1;

-- ============================================================================
-- Migration 1076: Assembly catalog rows, machine_class where still NULL
-- ============================================================================
-- The step migrations 1064 (Composites) and 1071 (Additive Manufacturing) are: each Assembly process_taxonomy / process_calculator_mappings
-- row (migrations 609, 790) gets the machine class its machines carry (migration 794; Laser Welding and Adhesive Bonding: migration 1075),
-- only where the row has none. A catalog row with no machine class cannot be active (chk_machine_class_required), and the Process dialog finds
-- a calculator by machine class: without this the assembly calculators would be linked to rows nobody can open. PEM Insertion keeps its
-- class (pem_press); No Cost Feature is not a manufacturing step and keeps none.
-- ============================================================================

UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
  ($str$Adhesive Bonding$str$, $str$adhesive_bonding$str$),
  ($str$Cap Sealing$str$, $str$cap_sealing$str$),
  ($str$Electron Beam Welding$str$, $str$electron_beam_welding$str$),
  ($str$Fay Sealing$str$, $str$fay_sealing$str$),
  ($str$Fillet Sealing$str$, $str$fillet_sealing$str$),
  ($str$Laser Welding$str$, $str$laser_welding$str$),
  ($str$Lock Bolt$str$, $str$lock_bolt$str$),
  ($str$Manual MIG Welding$str$, $str$manual_mig_welding$str$),
  ($str$Manual Spot Welding$str$, $str$manual_spot_welding$str$),
  ($str$Manual TIG Welding$str$, $str$manual_tig_welding$str$),
  ($str$Mechanical Assembly$str$, $str$mechanical_assembly$str$),
  ($str$Pick and Place$str$, $str$pick_and_place$str$),
  ($str$Rivet$str$, $str$rivet$str$),
  ($str$Robotic MIG Welding$str$, $str$robotic_mig_welding$str$),
  ($str$Robotic Spot Welding$str$, $str$robotic_spot_welding$str$),
  ($str$Robotic TIG Welding$str$, $str$robotic_tig_welding$str$),
  ($str$Threaded Insert$str$, $str$threaded_insert$str$),
  ($str$Ultrasonic Welding$str$, $str$assembly_ultrasonic_welding$str$),
  ($str$Weld Clean Up$str$, $str$weld_clean_up$str$),
  ($str$Weld Prep$str$, $str$weld_prep$str$)
) AS v(process_name, machine_class)
WHERE pt.process_group = 'Assembly' AND pt.process_name = v.process_name AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class, updated_at = now()
FROM (VALUES
  ($str$Adhesive Bonding$str$, $str$adhesive_bonding$str$),
  ($str$Cap Sealing$str$, $str$cap_sealing$str$),
  ($str$Electron Beam Welding$str$, $str$electron_beam_welding$str$),
  ($str$Fay Sealing$str$, $str$fay_sealing$str$),
  ($str$Fillet Sealing$str$, $str$fillet_sealing$str$),
  ($str$Laser Welding$str$, $str$laser_welding$str$),
  ($str$Lock Bolt$str$, $str$lock_bolt$str$),
  ($str$Manual MIG Welding$str$, $str$manual_mig_welding$str$),
  ($str$Manual Spot Welding$str$, $str$manual_spot_welding$str$),
  ($str$Manual TIG Welding$str$, $str$manual_tig_welding$str$),
  ($str$Mechanical Assembly$str$, $str$mechanical_assembly$str$),
  ($str$Pick and Place$str$, $str$pick_and_place$str$),
  ($str$Rivet$str$, $str$rivet$str$),
  ($str$Robotic MIG Welding$str$, $str$robotic_mig_welding$str$),
  ($str$Robotic Spot Welding$str$, $str$robotic_spot_welding$str$),
  ($str$Robotic TIG Welding$str$, $str$robotic_tig_welding$str$),
  ($str$Threaded Insert$str$, $str$threaded_insert$str$),
  ($str$Ultrasonic Welding$str$, $str$assembly_ultrasonic_welding$str$),
  ($str$Weld Clean Up$str$, $str$weld_clean_up$str$),
  ($str$Weld Prep$str$, $str$weld_prep$str$)
) AS v(operation, machine_class)
WHERE pcm.process_group = 'Assembly' AND pcm.operation = v.operation AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

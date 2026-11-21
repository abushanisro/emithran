-- ============================================================================
-- Migration 1099: Part Assembly catalog rows, machine_class where still NULL
-- ============================================================================
-- The step migration 1076 took for Assembly: each Part Assembly process_taxonomy / process_calculator_mappings row (migration 790) gets
-- the machine class its machines carry (migrations 795 and 827: the welders are part_assembly_*, so they never meet Assembly's own
-- welders of the same process names), only where the row has none. Migration 827 renamed the classes on rows that had none to rename, so
-- every one of the 9 rows is still NULL: a catalog row with no machine class cannot be active (chk_machine_class_required), and the
-- Process dialog finds a calculator by machine class, so the Part Assembly calculators (migration 1100) would link to rows nobody can open.
-- ============================================================================

UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
  ($str$Bevel Cutting$str$, $str$bevel_cutting$str$),
  ($str$Finish Grinding$str$, $str$finish_grinding$str$),
  ($str$Grinding$str$, $str$grinding$str$),
  ($str$Laser Seam Welding$str$, $str$laser_seam_welding$str$),
  ($str$Manual MIG Welding$str$, $str$part_assembly_manual_mig_welding$str$),
  ($str$Manual Spot Welding$str$, $str$part_assembly_manual_spot_welding$str$),
  ($str$Robotic MIG Welding$str$, $str$part_assembly_robotic_mig_welding$str$),
  ($str$Robotic Spot Welding$str$, $str$part_assembly_robotic_spot_welding$str$),
  ($str$Wire Brushing$str$, $str$wire_brushing$str$)
) AS v(process_name, machine_class)
WHERE pt.process_group = 'Part Assembly' AND pt.process_name = v.process_name AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class, updated_at = now()
FROM (VALUES
  ($str$Bevel Cutting$str$, $str$bevel_cutting$str$),
  ($str$Finish Grinding$str$, $str$finish_grinding$str$),
  ($str$Grinding$str$, $str$grinding$str$),
  ($str$Laser Seam Welding$str$, $str$laser_seam_welding$str$),
  ($str$Manual MIG Welding$str$, $str$part_assembly_manual_mig_welding$str$),
  ($str$Manual Spot Welding$str$, $str$part_assembly_manual_spot_welding$str$),
  ($str$Robotic MIG Welding$str$, $str$part_assembly_robotic_mig_welding$str$),
  ($str$Robotic Spot Welding$str$, $str$part_assembly_robotic_spot_welding$str$),
  ($str$Wire Brushing$str$, $str$wire_brushing$str$)
) AS v(operation, machine_class)
WHERE pcm.process_group = 'Part Assembly' AND pcm.operation = v.operation AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

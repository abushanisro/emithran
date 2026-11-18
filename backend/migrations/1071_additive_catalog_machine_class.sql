-- ============================================================================
-- Migration 1071: Additive Manufacturing catalog rows, machine_class where still NULL
-- ============================================================================
-- The step migration 1064 is for Composites: each Additive Manufacturing process_taxonomy / process_calculator_mappings row (migration 790)
-- gets the machine class its machine file seeded (migration 793; Cleaning: migration 1070), only where the row has none. A catalog row with
-- no machine class cannot be active (chk_machine_class_required), and the Process dialog finds a calculator by machine class: without this,
-- migration 1072 would link the additive calculators to rows nobody can open. No Cost Feature is not a manufacturing step and keeps none.
-- ============================================================================

UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
  ($str$Breakoff$str$, $str$breakoff$str$),
  ($str$Cleaning$str$, $str$cleaning$str$),
  ($str$Laser Sintering$str$, $str$laser_sintering$str$),
  ($str$Manual Tool Base Removal$str$, $str$manual_tool_base_removal$str$),
  ($str$Metal Sintering$str$, $str$metal_sintering$str$),
  ($str$Part Curing$str$, $str$part_curing$str$),
  ($str$Powder Loading$str$, $str$powder_loading$str$),
  ($str$Power Tool Base Removal$str$, $str$power_tool_base_removal$str$),
  ($str$Printing$str$, $str$printing$str$),
  ($str$Resin Curing$str$, $str$resin_curing$str$),
  ($str$Sieving$str$, $str$sieving$str$)
) AS v(process_name, machine_class)
WHERE pt.process_group = 'Additive Manufacturing' AND pt.process_name = v.process_name AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class, updated_at = now()
FROM (VALUES
  ($str$Breakoff$str$, $str$breakoff$str$),
  ($str$Cleaning$str$, $str$cleaning$str$),
  ($str$Laser Sintering$str$, $str$laser_sintering$str$),
  ($str$Manual Tool Base Removal$str$, $str$manual_tool_base_removal$str$),
  ($str$Metal Sintering$str$, $str$metal_sintering$str$),
  ($str$Part Curing$str$, $str$part_curing$str$),
  ($str$Powder Loading$str$, $str$powder_loading$str$),
  ($str$Power Tool Base Removal$str$, $str$power_tool_base_removal$str$),
  ($str$Printing$str$, $str$printing$str$),
  ($str$Resin Curing$str$, $str$resin_curing$str$),
  ($str$Sieving$str$, $str$sieving$str$)
) AS v(operation, machine_class)
WHERE pcm.process_group = 'Additive Manufacturing' AND pcm.operation = v.operation AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

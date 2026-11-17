-- ============================================================================
-- Migration 1064: Composites catalog rows, machine_class where still NULL
-- ============================================================================
-- The step migration 872 is for Casting Investment: each Composites process_taxonomy / process_calculator_mappings row (migration 790)
-- gets the machine class its machine file seeded (migration 796), only where the row has none. A catalog row with no machine class cannot
-- be active (chk_machine_class_required), and the Process dialog finds a calculator by machine class: without this, migration 1065 would
-- link the composites calculators to rows nobody can open.
--
-- Vacuum Bag and Final Vacuum Bag have no machine file in memory/Composites (migration 796 says so): a part is bagged on its tool in the
-- layup clean room, so they take the hand layup cell's class.
-- ============================================================================

UPDATE process_taxonomy pt
SET machine_class = v.machine_class
FROM (VALUES
  ($str$Autoclave Cure$str$, $str$autoclave_cure$str$),
  ($str$Automated Fiber Placement$str$, $str$automated_fiber_placement$str$),
  ($str$Automated Tape Layup$str$, $str$automated_tape_layup$str$),
  ($str$Bench Operation$str$, $str$composite_bench_operation$str$),
  ($str$Final Vacuum Bag$str$, $str$hand_layup$str$),
  ($str$Hand Layup$str$, $str$hand_layup$str$),
  ($str$Mold Preparation$str$, $str$mold_preparation$str$),
  ($str$Tool Clean$str$, $str$tool_clean$str$),
  ($str$Ultrasonic Cut$str$, $str$composite_ultrasonic_cut$str$),
  ($str$Vacuum Bag$str$, $str$hand_layup$str$)
) AS v(process_name, machine_class)
WHERE pt.process_group = 'Composites' AND pt.process_name = v.process_name AND pt.machine_class IS NULL;

UPDATE process_calculator_mappings pcm
SET machine_class = v.machine_class, updated_at = now()
FROM (VALUES
  ($str$Autoclave Cure$str$, $str$autoclave_cure$str$),
  ($str$Automated Fiber Placement$str$, $str$automated_fiber_placement$str$),
  ($str$Automated Tape Layup$str$, $str$automated_tape_layup$str$),
  ($str$Bench Operation$str$, $str$composite_bench_operation$str$),
  ($str$Final Vacuum Bag$str$, $str$hand_layup$str$),
  ($str$Hand Layup$str$, $str$hand_layup$str$),
  ($str$Mold Preparation$str$, $str$mold_preparation$str$),
  ($str$Tool Clean$str$, $str$tool_clean$str$),
  ($str$Ultrasonic Cut$str$, $str$composite_ultrasonic_cut$str$),
  ($str$Vacuum Bag$str$, $str$hand_layup$str$)
) AS v(operation, machine_class)
WHERE pcm.process_group = 'Composites' AND pcm.operation = v.operation AND pcm.machine_class IS NULL;

NOTIFY pgrst, 'reload schema';

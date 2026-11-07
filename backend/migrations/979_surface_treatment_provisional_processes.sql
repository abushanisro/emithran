-- ============================================================================
-- Migration 979: six Surface Treatment processes are costed, provisionally
-- ============================================================================
-- Black Oxide, Conveyor Oven Cure, Degrease, Oven Cure, Shot Blast and
-- Vibratory Finishing have machines in memory/SurfaceTreatment but no rule for
-- the time per part. The engine (backend costing/surface/surface-treatment-engine.ts)
-- now costs them from the machines and variables on file plus a stated rule or a
-- published figure (costing/secondary/provisional-reference.ts), and flags every
-- such line provisional: its trace and warnings name the figure, its source and
-- the published range. docs/secondary-operations-data-gaps.md lists each.
--
-- Sets roadmap_status production and is_active true for exactly these six rows.
-- The list is checked against SURFACE_MODELED_PROCESSES by a backend test
-- (with migrations 821 and 898). One DO block. Idempotent.
-- ============================================================================

DO $st979$
DECLARE
  n_tax integer;
  n_map integer;
BEGIN
  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Black Oxide$str$, $str$surface_black_oxide$str$, true),
    ($str$Conveyor Oven Cure$str$, $str$surface_conveyor_oven_cure$str$, true),
    ($str$Degrease$str$, $str$surface_degrease$str$, true),
    ($str$Oven Cure$str$, $str$surface_oven_cure$str$, true),
    ($str$Shot Blast$str$, $str$surface_shot_blast$str$, true),
    ($str$Vibratory Finishing$str$, $str$surface_vibratory_finishing$str$, true)
  )
  UPDATE process_taxonomy pt
  SET roadmap_status = 'production'
  FROM ref
  WHERE pt.process_group = 'Surface Treatment'
    AND pt.process_name = ref.process_name
    AND pt.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_tax = ROW_COUNT;

  WITH ref(process_name, machine_class) AS (VALUES
    ($str$Black Oxide$str$, $str$surface_black_oxide$str$),
    ($str$Conveyor Oven Cure$str$, $str$surface_conveyor_oven_cure$str$),
    ($str$Degrease$str$, $str$surface_degrease$str$),
    ($str$Oven Cure$str$, $str$surface_oven_cure$str$),
    ($str$Shot Blast$str$, $str$surface_shot_blast$str$),
    ($str$Vibratory Finishing$str$, $str$surface_vibratory_finishing$str$)
  )
  UPDATE process_calculator_mappings pcm
  SET is_active  = true,
      updated_at = now()
  FROM ref
  WHERE pcm.process_group = 'Surface Treatment'
    AND pcm.operation = ref.process_name
    AND pcm.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_map = ROW_COUNT;

  RAISE NOTICE 'Surface Treatment costed (provisional): % process_taxonomy rows, % process_calculator_mappings rows', n_tax, n_map;
END
$st979$;

NOTIFY pgrst, 'reload schema';

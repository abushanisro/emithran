-- ============================================================================
-- Migration 980: Powder Coat Cart and Conveyor Powder Coating are costed, provisionally
-- ============================================================================
-- Powder spray time = area x film thickness x specific gravity / transfer efficiency / gun flow rate
-- (memory/SurfaceTreatment variables for the efficiency and flow; the film thickness and the powder
-- specific gravity are published figures, costing/secondary/provisional-reference.ts). Every line is flagged
-- provisional.
--
-- Sets roadmap_status production and is_active true for exactly these two rows.
-- The list is checked against SURFACE_MODELED_PROCESSES by a backend test
-- (with migrations 821, 898 and 979). One DO block. Idempotent.
-- ============================================================================

DO $st980$
DECLARE
  n_tax integer;
  n_map integer;
BEGIN
  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Conveyor Powder Coating$str$, $str$surface_conveyor_powder_coating$str$, true),
    ($str$Powder Coat Cart$str$, $str$surface_powder_coat_cart$str$, true)
  )
  UPDATE process_taxonomy pt
  SET roadmap_status = 'production'
  FROM ref
  WHERE pt.process_group = 'Surface Treatment'
    AND pt.process_name = ref.process_name
    AND pt.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_tax = ROW_COUNT;

  WITH ref(process_name, machine_class) AS (VALUES
    ($str$Conveyor Powder Coating$str$, $str$surface_conveyor_powder_coating$str$),
    ($str$Powder Coat Cart$str$, $str$surface_powder_coat_cart$str$)
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
$st980$;

NOTIFY pgrst, 'reload schema';

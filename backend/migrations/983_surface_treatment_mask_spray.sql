-- ============================================================================
-- Migration 983: Mask-Spray is costed, provisionally
-- ============================================================================
-- Mask-Spray: the bores of the CAD-counted holes (pi x diameter x wall) x the maskant layers /
-- the booth spray rate, programming once per batch. The masked surfaces are not a CAD fact, so the
-- line is flagged provisional.
--
-- Sets roadmap_status production and is_active true for exactly this row.
-- The list is checked against SURFACE_MODELED_PROCESSES by a backend test
-- (with migrations 821, 898, 979, 980 and 982). One DO block. Idempotent.
-- ============================================================================

DO $st983$
DECLARE
  n_tax integer;
  n_map integer;
BEGIN
  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Mask-Spray$str$, $str$surface_mask_spray$str$, true)
  )
  UPDATE process_taxonomy pt
  SET roadmap_status = 'production'
  FROM ref
  WHERE pt.process_group = 'Surface Treatment'
    AND pt.process_name = ref.process_name
    AND pt.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_tax = ROW_COUNT;

  WITH ref(process_name, machine_class) AS (VALUES
    ($str$Mask-Spray$str$, $str$surface_mask_spray$str$)
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
$st983$;

NOTIFY pgrst, 'reload schema';

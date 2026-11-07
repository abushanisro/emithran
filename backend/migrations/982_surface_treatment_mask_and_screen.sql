-- ============================================================================
-- Migration 982: Mask-Bench and Screen Printing are costed, provisionally
-- ============================================================================
-- Mask-Bench: one plug per detected CAD hole at the bench plug time. Screen Printing: the part's
-- largest face x the machine application cost x size and color multipliers. Both rules are stated
-- on the line and the line is flagged provisional (the masked features and printed area are not
-- CAD facts).
--
-- Sets roadmap_status production and is_active true for exactly these two rows.
-- The list is checked against SURFACE_MODELED_PROCESSES by a backend test
-- (with migrations 821, 898, 979 and 980). One DO block. Idempotent.
-- ============================================================================

DO $st982$
DECLARE
  n_tax integer;
  n_map integer;
BEGIN
  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Mask-Bench$str$, $str$surface_mask_bench$str$, true),
    ($str$Screen Printing$str$, $str$surface_screen_printing$str$, true)
  )
  UPDATE process_taxonomy pt
  SET roadmap_status = 'production'
  FROM ref
  WHERE pt.process_group = 'Surface Treatment'
    AND pt.process_name = ref.process_name
    AND pt.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_tax = ROW_COUNT;

  WITH ref(process_name, machine_class) AS (VALUES
    ($str$Mask-Bench$str$, $str$surface_mask_bench$str$),
    ($str$Screen Printing$str$, $str$surface_screen_printing$str$)
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
$st982$;

NOTIFY pgrst, 'reload schema';

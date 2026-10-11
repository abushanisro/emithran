-- ============================================================================
-- Migration 898: Passivation, Anodize and Wet Coat Line are costed
-- ============================================================================
-- Migration 821 marked these three not_modeled. The surface-treatment engine
-- (backend costing/surface/surface-treatment-engine.ts) now costs them from
-- the reference data already staged by migrations 819 / 820:
--   Passivation    parts per tank load from the tank window, spacing factor,
--                  height and weight limits; immersion time per cut code from
--                  passivationTreatments (the shortest listed treatment).
--   Anodize        one loadbar per Load Window Time; parts per loadbar from the
--                  loadbar window, spacing factor and max load surface area;
--                  the line of the anodizing type named on the drawing; the
--                  line minimum batch cost as a floor.
--   Wet Coat Line  one loadbar per Load Window Time; parts per loadbar from the
--                  window, spacing factor and weight limit; paint = area /
--                  coverage x paint cost.
-- (Load Window Time = time per loadbar and the shortest passivation treatment:
-- user decisions 2026-10-09.)
--
-- Sets roadmap_status production and is_active true for exactly these three
-- Surface Treatment rows. The list is checked against the engine
-- SURFACE_MODELED_PROCESSES by a backend test (with migration 821).
-- One DO block. Idempotent.
-- ============================================================================

DO $st898$
DECLARE
  n_tax integer;
  n_map integer;
BEGIN
  WITH ref(process_name, machine_class, modeled) AS (VALUES
    ($str$Anodize$str$, $str$surface_anodize$str$, true),
    ($str$Passivation$str$, $str$surface_passivation$str$, true),
    ($str$Wet Coat Line$str$, $str$surface_wet_coat_line$str$, true)
  )
  UPDATE process_taxonomy pt
  SET roadmap_status = 'production'
  FROM ref
  WHERE pt.process_group = 'Surface Treatment'
    AND pt.process_name = ref.process_name
    AND pt.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_tax = ROW_COUNT;

  WITH ref(process_name, machine_class) AS (VALUES
    ($str$Anodize$str$, $str$surface_anodize$str$),
    ($str$Passivation$str$, $str$surface_passivation$str$),
    ($str$Wet Coat Line$str$, $str$surface_wet_coat_line$str$)
  )
  UPDATE process_calculator_mappings pcm
  SET is_active  = true,
      updated_at = now()
  FROM ref
  WHERE pcm.process_group = 'Surface Treatment'
    AND pcm.operation = ref.process_name
    AND pcm.machine_class = ref.machine_class;
  GET DIAGNOSTICS n_map = ROW_COUNT;

  RAISE NOTICE 'Surface Treatment costed: % process_taxonomy rows, % process_calculator_mappings rows', n_tax, n_map;
END
$st898$;

NOTIFY pgrst, 'reload schema';

-- Verify:
-- SELECT process_name, roadmap_status FROM process_taxonomy
-- WHERE process_group = 'Surface Treatment' AND process_name IN ('Anodize', 'Passivation', 'Wet Coat Line');

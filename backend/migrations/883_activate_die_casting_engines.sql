-- ============================================================================
-- Migration 883: activate the Die Casting processes that now have an engine
-- ============================================================================
-- Migration 844 seeded every Die Casting catalog row inactive and
-- roadmap_status not_modeled because no costing engine existed. These now do
-- (backend costing/casting), and a die-cast part's Cost Summary runs them in
-- route order:
--   High Pressure Die Casting  hpdc-engine.ts (clamp, cycle, machine choice)
--   Trim                       casting-finishing.ts trimLine (press cycle time)
--   Cleaning                   casting-finishing.ts cleaningLine (load model)
--   Visual Inspection          casting-finishing.ts visualInspectionLine (tblVisualInspection)
-- resolveProcessIdentities reads active rows only, so activation is what lets
-- each line resolve its catalog process.
--
-- Deliberately left inactive (no engine, said on the quote where relevant):
--   Melting            furnaces carry no machine-hour rate in memory/Die Casting
--   Gravity Die Casting, Coremaking, Core Refractory Coat, Finishing,
--   Refractory Coat Air Dry / Oven Dry, No Cost Feature
-- Idempotent.
-- ============================================================================

UPDATE public.process_calculator_mappings
SET is_active = true, updated_at = now()
WHERE process_group = 'Die Casting'
  AND machine_class IN ('die_casting_high_pressure_die_casting', 'die_casting_trim', 'die_casting_cleaning', 'die_casting_visual_inspection')
  AND is_active = false;

UPDATE public.process_taxonomy
SET roadmap_status = 'production'
WHERE process_group = 'Die Casting'
  AND machine_class IN ('die_casting_high_pressure_die_casting', 'die_casting_trim', 'die_casting_cleaning', 'die_casting_visual_inspection')
  AND roadmap_status IS DISTINCT FROM 'production';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 4 rows, active, production):
-- SELECT pcm.operation, pcm.machine_class, pcm.is_active, pt.roadmap_status
-- FROM public.process_calculator_mappings pcm
-- JOIN public.process_taxonomy pt ON pt.id = pcm.canonical_process_id
-- WHERE pcm.process_group = 'Die Casting' ORDER BY pcm.operation;

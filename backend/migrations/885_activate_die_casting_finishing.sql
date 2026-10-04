-- ============================================================================
-- Migration 885: activate Die Casting Finishing (parting-line grinding)
-- ============================================================================
-- Finishing now has an engine: casting-finishing.ts partingLineGrindingLine
-- (parting-line flash from the measured parting perimeter and
-- tblGrindingDimensions, ground at each finishing machine speed x the alloy
-- tblGrindingSpeedMaterialFactor). Same pattern as migration 883: activate the
-- mapping so the line resolves its catalog process, and mark it production.
-- Idempotent.
-- ============================================================================

UPDATE public.process_calculator_mappings
SET is_active = true, updated_at = now()
WHERE process_group = 'Die Casting'
  AND machine_class = 'die_casting_finishing'
  AND is_active = false;

UPDATE public.process_taxonomy
SET roadmap_status = 'production'
WHERE process_group = 'Die Casting'
  AND machine_class = 'die_casting_finishing'
  AND roadmap_status IS DISTINCT FROM 'production';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 1 row, active, production):
-- SELECT pcm.operation, pcm.machine_class, pcm.is_active, pt.roadmap_status
-- FROM public.process_calculator_mappings pcm
-- JOIN public.process_taxonomy pt ON pt.id = pcm.canonical_process_id
-- WHERE pcm.machine_class = 'die_casting_finishing';

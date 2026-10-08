-- ============================================================================
-- Migration 888: activate Die Casting Melting
-- ============================================================================
-- Melting now has an engine: costing/casting/casting-finishing.ts meltingLine.
-- Per kg of metal melted: regionConvFactor (memory/Die Casting, the cost of
-- melting this metal relative to ductile iron) x the Conversion Cost of the
-- ductile-iron melter Induction - DI (memory/Casting/Machine/
-- pmmelting_machines.csv, HR Rates class casting_pm_melting, migration 848),
-- on a real die-casting furnace (class die_casting_melting, migration 845)
-- chosen by temperature and capacity. Same pattern as migrations 883 and
-- 885-887. Idempotent.
-- ============================================================================

UPDATE public.process_calculator_mappings
SET is_active = true, updated_at = now()
WHERE process_group = 'Die Casting'
  AND machine_class = 'die_casting_melting'
  AND is_active = false;

UPDATE public.process_taxonomy
SET roadmap_status = 'production'
WHERE process_group = 'Die Casting'
  AND machine_class = 'die_casting_melting'
  AND roadmap_status IS DISTINCT FROM 'production';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 1 row, active, production):
-- SELECT pcm.operation, pcm.machine_class, pcm.is_active, pt.roadmap_status
-- FROM public.process_calculator_mappings pcm
-- JOIN public.process_taxonomy pt ON pt.id = pcm.canonical_process_id
-- WHERE pcm.machine_class = 'die_casting_melting';

-- ============================================================================
-- Migration 887: activate the Die Casting sand-core processes
-- ============================================================================
-- Coremaking, Core Refractory Coat, Refractory Coat Air Dry and Refractory
-- Coat Oven Dry now have an engine: costing/casting/coremaking.ts, pricing the
-- cores the cad-engine measures (shared/core_geometry.py) on the gravity die
-- casting route, on the real HR Rates machines of migration 845. Same pattern
-- as migrations 883, 885 and 886. Idempotent.
-- ============================================================================

UPDATE public.process_calculator_mappings
SET is_active = true, updated_at = now()
WHERE process_group = 'Die Casting'
  AND machine_class IN ('die_casting_coremaking', 'die_casting_core_refractory_coat',
                        'die_casting_refractory_coat_air_dry', 'die_casting_refractory_coat_oven_dry')
  AND is_active = false;

UPDATE public.process_taxonomy
SET roadmap_status = 'production'
WHERE process_group = 'Die Casting'
  AND machine_class IN ('die_casting_coremaking', 'die_casting_core_refractory_coat',
                        'die_casting_refractory_coat_air_dry', 'die_casting_refractory_coat_oven_dry')
  AND roadmap_status IS DISTINCT FROM 'production';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 4 rows, active, production):
-- SELECT pcm.operation, pcm.machine_class, pcm.is_active, pt.roadmap_status
-- FROM public.process_calculator_mappings pcm
-- JOIN public.process_taxonomy pt ON pt.id = pcm.canonical_process_id
-- WHERE pcm.machine_class IN ('die_casting_coremaking', 'die_casting_core_refractory_coat',
--   'die_casting_refractory_coat_air_dry', 'die_casting_refractory_coat_oven_dry');

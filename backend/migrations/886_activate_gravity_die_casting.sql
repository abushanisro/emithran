-- ============================================================================
-- Migration 886: activate Gravity Die Casting
-- ============================================================================
-- Gravity Die Casting now has an engine: costing/casting/gdc-engine.ts (cycle
-- from the memory/Die Casting gravity variables, the 20 real gravity machines
-- of HR Rates class die_casting_gravity_die_casting, migration 845). A die-cast
-- part is priced on both HPDC and GDC and quoted on the Cost Guide choice or
-- the cheapest feasible one. Same pattern as migrations 883 and 885: activate
-- the mapping so the line resolves its catalog process, mark it production.
-- Idempotent.
-- ============================================================================

UPDATE public.process_calculator_mappings
SET is_active = true, updated_at = now()
WHERE process_group = 'Die Casting'
  AND machine_class = 'die_casting_gravity_die_casting'
  AND is_active = false;

UPDATE public.process_taxonomy
SET roadmap_status = 'production'
WHERE process_group = 'Die Casting'
  AND machine_class = 'die_casting_gravity_die_casting'
  AND roadmap_status IS DISTINCT FROM 'production';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 1 row, active, production):
-- SELECT pcm.operation, pcm.machine_class, pcm.is_active, pt.roadmap_status
-- FROM public.process_calculator_mappings pcm
-- JOIN public.process_taxonomy pt ON pt.id = pcm.canonical_process_id
-- WHERE pcm.machine_class = 'die_casting_gravity_die_casting';

-- ============================================================================
-- Migration 843: activate the Hydroform and Offline Blank catalog mappings
-- ============================================================================
-- Migration 792 seeded both process_calculator_mappings rows inactive because
-- no costing engine existed for them. The hydroforming engine now does
-- (costing/hydroforming): route comparison offers Offline Blank + Hydroform for
-- a part with a drawn shell, and each line resolves its catalog process through
-- these rows (resolveProcessIdentities reads active rows only). Activation
-- changes no rate: the Hydroform presses still have none (migration 828) and
-- their line stays not costed.
-- Idempotent.
-- ============================================================================

UPDATE public.process_calculator_mappings
SET is_active = true
WHERE process_group = 'Sheet Metal - Hydroforming'
  AND machine_class IN ('hydroform', 'hydroform_offline_blank')
  AND is_active = false;

NOTIFY pgrst, 'reload schema';

-- Verify (expect 2 rows, both true):
-- SELECT machine_class, operation, is_active FROM public.process_calculator_mappings
-- WHERE machine_class IN ('hydroform', 'hydroform_offline_blank');

-- ============================================================================
-- Migration 616: Activate non-mfg routing markers; deactivate Plasma Cut
-- ============================================================================
-- Root-cause pass on the 8 currently-inactive-or-risky Sheet Metal rows
-- (2026-09-01), before any blanket "activate everything" action:
--
-- SAFE TO ACTIVATE -- Material Stock and No Cost Feature are non_mfg
-- routing-spine markers (see process_taxonomy.roadmap_status, and this
-- session's own Phase 1 findings) -- zero-cost by definition, not real
-- chargeable operations. Activating them carries no pricing-correctness
-- risk, unlike the other 6.
--
-- NOT activated here -- Progressive die, Generic Press, Laser Punch,
-- Plasma Punch, OxyFuel Cut, Shearing: none have a real registered cost
-- engine (confirmed against manufacturing-process-registry.ts). Shearing
-- in particular is the exact machine class involved in the migration
-- 388/533/605 incident (a real live bug: a saved Shearning step showed an
-- unrelated Progressive Die Press machine at $0.00). Activating any of
-- these 6 without a real engine first reopens that same bug class.
--
-- NEW FINDING, fixed here -- "Plasma Cut" is currently ACTIVE despite
-- having ZERO registered cost engine (confirmed directly:
-- sheet-metal-nesting.engine.ts's own header comment: "Oxyfuel/Plasma
-- have no cost engine here regardless of this data"). This is the same
-- bug class as the Shearing incident, live right now, not something this
-- migration introduces -- deactivating it here, matching the Shearing
-- precedent, until a real Plasma cost engine exists.
-- ============================================================================

BEGIN;

UPDATE process_calculator_mappings
SET is_active = true, updated_at = NOW()
WHERE process_group = 'Sheet Metal'
  AND operation IN ('Material Stock', 'No Cost Feature');

UPDATE process_calculator_mappings
SET is_active = false, updated_at = NOW()
WHERE process_group = 'Sheet Metal'
  AND operation = 'Plasma Cut';

COMMIT;

-- Verification (run manually after):
-- SELECT operation, is_active, machine_class FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation IN ('Material Stock', 'No Cost Feature', 'Plasma Cut');
-- -- Expect Material Stock/No Cost Feature is_active=true, Plasma Cut is_active=false.

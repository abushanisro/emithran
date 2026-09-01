-- ============================================================================
-- Migration 617: Exempt 'Material Usage' from chk_machine_class_required;
-- retry migration 616
-- ============================================================================
-- Migration 369's chk_machine_class_required constraint correctly blocks
-- any active row with machine_class IS NULL, with 3 named exemptions for
-- legitimate non-machine rows: process_route = 'Raw Material',
-- process_group = 'Packing & Delivery', and process_route/operation =
-- 'General'/'General'. Sheet Metal's 'Material Usage' route (Material
-- Stock, No Cost Feature -- process_taxonomy.roadmap_status = 'non_mfg',
-- confirmed Phase 1 finding: "system marker, not a manufacturing
-- process") is the exact same kind of thing as the 'Raw Material'
-- exemption -- a non-machine routing/material marker, zero cost by
-- design -- but was never added to the exemption list. This is a missing
-- exemption, not a reason to fabricate a fake machine_class just to
-- satisfy the check.
-- ============================================================================

BEGIN;

ALTER TABLE process_calculator_mappings DROP CONSTRAINT chk_machine_class_required;
ALTER TABLE process_calculator_mappings
  ADD CONSTRAINT chk_machine_class_required
  CHECK (
    is_active = false
    OR machine_class IS NOT NULL
    OR process_route = 'Raw Material'
    OR process_route = 'Material Usage'
    OR process_group = 'Packing & Delivery'
    OR (process_route = 'General' AND operation = 'General')
  );

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

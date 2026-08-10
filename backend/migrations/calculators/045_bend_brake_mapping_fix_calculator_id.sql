-- ============================================================================
-- process_calculator_mappings: "Bend Brake" row referenced a nonexistent
-- calculator by name, silently breaking calculator auto-select
--
-- The "Bend Brake" mapping row (process_group='Sheet Metal', process_route=
-- 'Bending/Floating /Forming') had calculator_id = NULL and only a
-- calculator_name of 'Press Brake Calculator' — a calculator that does not
-- exist in the calculators table at all (confirmed via direct query: zero
-- exact-name matches). ProcessCostDialog.tsx's defaultCalculatorForOperation
-- resolves calculator_id first, falling back to a calculator_name lookup only
-- when calculator_id is NULL — since neither path found a match, the Cycle
-- Time calculator panel always opened with a blank "Choose a calculator"
-- picker for this operation, even though bom-items.service.ts's backend cost
-- pipeline already resolves and uses the correct calculator directly by ID
-- for the SAME operation (see migration 044) and computes real, correct cycle
-- times with it. This only fixes which calculator the interactive picker
-- pre-selects — it does not change any cost calculation, which was already
-- correct.
--
-- Fix: point calculator_id directly at the real calculator
-- ('Sheet Metal - Bending Manufacturing', the same one migration 044 already
-- extended and bom-items.service.ts already uses server-side), matching the
-- working "Laser Cut" mapping row's pattern (calculator_id set directly,
-- not resolved by name).
-- ============================================================================

UPDATE process_calculator_mappings
SET calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b',
    calculator_name = 'Sheet Metal - Bending Manufacturing'
WHERE process_group = 'Sheet Metal'
  AND process_route = 'Bending/Floating /Forming'
  AND operation = 'Bend Brake'
  AND calculator_id IS NULL;

-- Verification:
-- SELECT id, process_group, process_route, operation, calculator_id, calculator_name
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation = 'Bend Brake';

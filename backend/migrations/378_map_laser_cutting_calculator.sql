-- ============================================================================
-- Migration 378: Map Sheet Metal / Laser Cutting operations to the real
-- "Sheet Metal - Laser Cutting Manufacturing" calculator.
--
-- Root cause: identical to migration 377's Press Brake / Bend fix.
-- process_calculator_mappings rows for Sheet Metal / Laser Cutting /
-- {Laser Cut, Fiber Laser Cut, CO2 Laser Cut, 3D Laser Cut} were seeded
-- (317_seed_sheet_metal_routing.sql, re-seeded no-op in
-- 344_comprehensive_process_mappings.sql) with calculator_name/calculator_id
-- both NULL — never mapped to anything, so the "Edit Process Cost" dialog's
-- Cycle Time calculator has nothing to auto-select.
--
-- Unlike Bending, the real calculator here ("Sheet Metal - Laser Cutting
-- Manufacturing") already has correct, real formulas for Cutting Time,
-- Piercing Time, and Total Time — no formula changes needed in this
-- migration. The one remaining gap (Cutting Speed being a manual field
-- instead of a real sm_lookup_laser_cut value) is resolved entirely on the
-- frontend (ProcessCostDialog.tsx autoPopulateFromBOM), since it needs no
-- new database_lookup wiring at the field-definition level — just mapping
-- this calculator to the operation is enough for auto-select to work.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_mapped_count INTEGER;
BEGIN
  SELECT id INTO v_calc_id FROM calculators WHERE name = 'Sheet Metal - Laser Cutting Manufacturing' LIMIT 1;
  IF v_calc_id IS NULL THEN
    RAISE EXCEPTION 'Migration 378 aborted: calculator "Sheet Metal - Laser Cutting Manufacturing" not found.';
  END IF;

  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id,
      calculator_name = 'Sheet Metal - Laser Cutting Manufacturing'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Laser Cutting'
    AND operation IN ('Laser Cut', 'Fiber Laser Cut', 'CO2 Laser Cut', '3D Laser Cut');

  GET DIAGNOSTICS v_mapped_count = ROW_COUNT;
  IF v_mapped_count = 0 THEN
    RAISE EXCEPTION 'Migration 378 incomplete: expected to map Laser Cutting rows but updated 0 — check process_calculator_mappings seed data (317_seed_sheet_metal_routing.sql).';
  END IF;

  RAISE NOTICE 'Migration 378 done: calculator %, % mapping row(s) updated.', v_calc_id, v_mapped_count;
END $$;

-- Verification:
-- SELECT process_group, process_route, operation, calculator_id, calculator_name
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND process_route = 'Laser Cutting';

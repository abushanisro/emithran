-- ============================================================================
-- Migration 402: Fix phantom calculator_name reference on the "Water jet
-- Cutting" (with space) process_calculator_mappings row.
--
-- Live QA found TWO separate mapping rows for the same real operation,
-- differing only by a space in the operation name:
--   process_route='Sheet Cutting', operation='Water jet Cutting'  (display_order=204)
--     -> calculator_id=NULL, calculator_name='Water Jet Calculator'
--        (a calculator that does not exist anywhere in the calculators table
--        -- a stale reference, presumably from an earlier, never-finished
--        attempt to wire this up, well before migrations 398-401 built a
--        real one this session)
--   process_route='Sheet Cutting', operation='Waterjet Cutting'   (display_order=306)
--     -> calculator_id='37a8bb8c-85fa-4ae0-8bf9-bf7f1b491e72',
--        calculator_name='Sheet Metal - Waterjet Cutting Manufacturing'
--        (the real one, correctly wired by migration 401)
--
-- applyRoute()'s hierarchy resolver (bom-items.controller.ts) picks the
-- lowest display_order for a given machine_class, so it always persisted the
-- FIRST (broken) row's operation spelling -- "Water jet Cutting" -- onto
-- every applied-route process_cost_records row, and the Edit Process Cost
-- dialog's own operation-based calculator lookup then found the same broken
-- row and its non-existent calculator_name, showing "Choose a calculator"
-- with nothing to select.
--
-- Fix: point the phantom row at the SAME real calculator, rather than
-- renaming/deleting either row (least destructive -- both operation
-- spellings now resolve correctly regardless of which one a given code path
-- happens to pick).
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_updated_count INTEGER;
BEGIN
  SELECT id INTO v_calc_id FROM calculators WHERE name = 'Sheet Metal - Waterjet Cutting Manufacturing' LIMIT 1;
  IF v_calc_id IS NULL THEN
    RAISE EXCEPTION 'Migration 402 aborted: calculator "Sheet Metal - Waterjet Cutting Manufacturing" not found — run migration 400 first.';
  END IF;

  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id,
      calculator_name = 'Sheet Metal - Waterjet Cutting Manufacturing'
  WHERE process_group = 'Sheet Metal'
    AND process_route = 'Sheet Cutting'
    AND operation = 'Water jet Cutting';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Migration 402 incomplete: expected to fix the "Water jet Cutting" row but updated 0.';
  END IF;

  RAISE NOTICE 'Migration 402 done: calculator %, % row(s) updated.', v_calc_id, v_updated_count;
END $$;

-- Verification:
-- SELECT process_route, operation, calculator_id, calculator_name, display_order
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND (machine_class = 'waterjet' OR operation ILIKE '%water%jet%')
--   ORDER BY display_order;
-- Both rows should now show the same calculator_id/calculator_name.

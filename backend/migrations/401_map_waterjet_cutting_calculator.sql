-- ============================================================================
-- Migration 401: Map Sheet Metal / Waterjet Cutting operations to the real
-- "Sheet Metal - Waterjet Cutting Manufacturing" calculator (migration 400).
--
-- Same root cause/pattern as migration 378 (Laser Cutting): process_calculator_
-- mappings rows for Waterjet Cutting were seeded (344_comprehensive_process_
-- mappings.sql, gap-filled for machine_class in 369_process_mapping_machine_
-- class_gap_fill.sql) with calculator_name/calculator_id both NULL — the "Edit
-- Process Cost" dialog's Cycle Time calculator had nothing to auto-select,
-- because until this session there was no real Waterjet Cutting calculator to
-- map to at all (migrations 398/399/400 built it).
--
-- Covers both real mapping rows migration 369 found for this operation name:
-- the route-level one (process_route = 'Waterjet Cutting') and the distinct
-- row under process_route = 'Sheet Cutting' (see 369's own comment: "distinct
-- row from the route-level one").
--
-- Run in: Supabase SQL Editor
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_mapped_count INTEGER;
BEGIN
  SELECT id INTO v_calc_id FROM calculators WHERE name = 'Sheet Metal - Waterjet Cutting Manufacturing' LIMIT 1;
  IF v_calc_id IS NULL THEN
    RAISE EXCEPTION 'Migration 401 aborted: calculator "Sheet Metal - Waterjet Cutting Manufacturing" not found — run migration 400 first.';
  END IF;

  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id,
      calculator_name = 'Sheet Metal - Waterjet Cutting Manufacturing'
  WHERE process_group = 'Sheet Metal'
    AND ((process_route = 'Waterjet Cutting' AND operation IN ('Waterjet Cutting', 'Water Jet Cutting', 'Abrasive Waterjet'))
         OR (process_route = 'Sheet Cutting' AND operation = 'Waterjet Cutting'));

  GET DIAGNOSTICS v_mapped_count = ROW_COUNT;
  IF v_mapped_count = 0 THEN
    RAISE EXCEPTION 'Migration 401 incomplete: expected to map Waterjet Cutting rows but updated 0 — check process_calculator_mappings seed data (344_comprehensive_process_mappings.sql).';
  END IF;

  RAISE NOTICE 'Migration 401 done: calculator %, % mapping row(s) updated.', v_calc_id, v_mapped_count;
END $$;

-- Verification:
-- SELECT process_group, process_route, operation, calculator_id, calculator_name
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation ILIKE '%waterjet%';

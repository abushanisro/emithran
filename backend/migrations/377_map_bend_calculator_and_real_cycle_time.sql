-- ============================================================================
-- Migration 377: Map Sheet Metal / Press Brake operations to a real calculator,
-- and give that calculator's Cycle Time a real formula.
--
-- Root cause #1: process_calculator_mappings rows for Sheet Metal / Press Brake /
-- {Bend, Form, Press Brake Bend} were seeded (migration 317) with calculator_name
-- and calculator_id left NULL — no calculator was ever mapped to them, so the
-- "Edit Process Cost" dialog's auto-select-calculator feature has nothing to pick.
--
-- Root cause #2: the one real bending-domain calculator that exists,
-- "Sheet Metal - Bending Manufacturing" (seeded in
-- migrations/calculators/009_sheet_metal_bending_manufacturing_calculator.sql),
-- has "Cycle Time" as a manual number input with no formula behind it — so even
-- after auto-filling geometry from the BOM item and clicking Calculate, the
-- displayed Cycle Time would just be whatever the user typed, not a real
-- computed value.
--
-- Fix: map the three operations to that calculator, and give Cycle Time a real
-- formula using the same manual-stroke-time lookup table (sm_lookup_manual_stroke)
-- the backend cost-engine (cost-engine.ts) already uses for Press Brake costing —
-- via two new input fields:
--   - Complexity: a real, required parameter of the eMithran bending methodology
--     (Tier/Complexity Classification) with no BOM-derivable value — the engineer
--     must choose it, same as material grade elsewhere in this app. Not a guess.
--   - Stroke Time Per Bend: resolved automatically by the frontend (two-pass
--     execute — see ProcessCostDialog.tsx's handleExecuteCalculator) from the
--     real sm_lookup_manual_stroke table (thickness x tonnage x complexity),
--     never typed manually and never hardcoded.
--
-- Run in: Supabase SQL Editor
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_mapped_count INTEGER;
BEGIN
  SELECT id INTO v_calc_id FROM calculators WHERE name = 'Sheet Metal - Bending Manufacturing' LIMIT 1;
  IF v_calc_id IS NULL THEN
    RAISE EXCEPTION 'Migration 377 aborted: calculator "Sheet Metal - Bending Manufacturing" not found (expected to already exist from migrations/calculators/009).';
  END IF;

  -- Add "Complexity" input (select) — required, no formula, no default guess
  -- beyond the visible "Simple" starting value the engineer can change.
  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  SELECT v_calc_id, 'Complexity', 'Complexity (Simple / Intermediate / Complex)', 'select', NULL, NULL, 21, false, 'Simple'
  WHERE NOT EXISTS (
    SELECT 1 FROM calculator_fields WHERE calculator_id = v_calc_id AND field_name = 'Complexity'
  );

  -- Add "Stroke Time Per Bend" input — resolved automatically by the frontend
  -- from the real sm_lookup_manual_stroke table. data_source = 'sheet_metal_lookup'
  -- is the existing, constraint-allowed value (see 301_extend_data_source_constraint.sql)
  -- for exactly this category of field; source_field names which of the 6
  -- sm_lookup_* tables to call ('manual_stroke'), matching the tableName param
  -- CalculatorsServiceV2.resolveSheetMetalLookup() already accepts. The generic
  -- calculator engine only reads plain inputs — it cannot call this lookup
  -- mid-formula — so the frontend resolves it between two execute() passes.
  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, source_field, display_order, is_required, default_value)
  SELECT v_calc_id, 'Stroke Time Per Bend', 'Stroke Time Per Bend (sec)', 'number', 'sec', 'sheet_metal_lookup', 'manual_stroke', 22, false, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM calculator_fields WHERE calculator_id = v_calc_id AND field_name = 'Stroke Time Per Bend'
  );

  -- Cycle Time: was a manual/AI-supplied guess field with no formula — now a
  -- real formula: real stroke time per bend (from the DB lookup table) x bend
  -- count, plus real sheet handling time. Mirrors cost-engine.ts's press-brake
  -- formula (manualStrokeTimeSec + handlingTimeMin*60) exactly.
  UPDATE calculator_fields
  SET field_type = 'calculated',
      default_value = '({Stroke Time Per Bend} * {No Of Bends}) + ({Sheet Loading Time} * 60)'
  WHERE calculator_id = v_calc_id AND field_name = 'Cycle Time';

  -- Map the three Press Brake operations that share this real methodology to
  -- this calculator (they were never mapped to anything before this migration).
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id,
      calculator_name = 'Sheet Metal - Bending Manufacturing'
  WHERE process_group = 'Sheet Metal' AND process_route = 'Press Brake'
    AND operation IN ('Bend', 'Form', 'Press Brake Bend');

  GET DIAGNOSTICS v_mapped_count = ROW_COUNT;
  IF v_mapped_count = 0 THEN
    RAISE EXCEPTION 'Migration 377 incomplete: expected to map 3 row(s) (Bend/Form/Press Brake Bend under Sheet Metal/Press Brake) but updated 0 — check process_calculator_mappings seed data (migration 317_seed_sheet_metal_routing.sql).';
  END IF;

  RAISE NOTICE 'Migration 377 done: calculator %, % process_calculator_mappings row(s) updated.', v_calc_id, v_mapped_count;
END $$;

-- Verification:
-- SELECT field_name, field_type, data_source, source_field, default_value, display_order
--   FROM calculator_fields
--   WHERE calculator_id = (SELECT id FROM calculators WHERE name = 'Sheet Metal - Bending Manufacturing')
--   ORDER BY display_order;
-- SELECT process_group, process_route, operation, calculator_id, calculator_name
--   FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND process_route = 'Press Brake';

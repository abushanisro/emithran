-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 468: Map "Sheet Metal - Net/Gross Material Usage" calculators
--
-- Run AFTER calculators/057 and calculators/058 (which must themselves run
-- after 470). Mirrors the exact convention already established for Laser
-- Cutting (migration 378 -- process_calculator_mappings row; migration 056
-- -- physics_key column) applied here in one migration since both new
-- calculators are net-new (no pre-existing mapping rows to retrofit).
--
-- machine_class values 'sheet_metal_net_usage'/'sheet_metal_gross_usage_
-- nesting' are new string keys -- process_calculator_mappings.machine_class
-- has no FK/CHECK constraint requiring a real machine (confirmed: it's a
-- plain nullable VARCHAR(100), migration 368), so these resolve through
-- resolvePhysicsQuantity exactly the same way 'fiber_laser' etc. do today,
-- despite not naming an actual machine.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_net_calc_id UUID;
  v_gross_calc_id UUID;
BEGIN
  SELECT id INTO v_net_calc_id FROM calculators WHERE name = 'Sheet Metal - Net Material Usage' AND user_id IS NULL LIMIT 1;
  IF v_net_calc_id IS NULL THEN
    RAISE EXCEPTION 'Migration 468 aborted: calculator "Sheet Metal - Net Material Usage" not found (run calculators/057 first).';
  END IF;

  SELECT id INTO v_gross_calc_id FROM calculators WHERE name = 'Sheet Metal - Gross Material Usage (Nesting)' AND user_id IS NULL LIMIT 1;
  IF v_gross_calc_id IS NULL THEN
    RAISE EXCEPTION 'Migration 468 aborted: calculator "Sheet Metal - Gross Material Usage (Nesting)" not found (run calculators/058 first).';
  END IF;

  INSERT INTO process_calculator_mappings
    (process_group, process_route, operation, calculator_id, calculator_name, machine_class, is_active)
  VALUES
    ('Sheet Metal', 'Material Usage', 'Net Usage',   v_net_calc_id,   'Sheet Metal - Net Material Usage',              'sheet_metal_net_usage',           true),
    ('Sheet Metal', 'Material Usage', 'Gross Usage', v_gross_calc_id, 'Sheet Metal - Gross Material Usage (Nesting)', 'sheet_metal_gross_usage_nesting', true)
  ON CONFLICT (process_group, process_route, operation) DO UPDATE
    SET calculator_id = EXCLUDED.calculator_id,
        calculator_name = EXCLUDED.calculator_name,
        machine_class = EXCLUDED.machine_class,
        is_active = true;

  UPDATE calculators SET physics_key = 'sheet_metal_net_usage' WHERE id = v_net_calc_id;
  UPDATE calculators SET physics_key = 'sheet_metal_gross_usage_nesting' WHERE id = v_gross_calc_id;

  RAISE NOTICE 'Done — mapped Net Usage calc %, Gross Usage calc %', v_net_calc_id, v_gross_calc_id;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────────
-- SELECT machine_class, calculator_name, is_active FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND process_route = 'Material Usage';
-- SELECT name, physics_key, is_public, user_id FROM calculators
--   WHERE name IN ('Sheet Metal - Net Material Usage', 'Sheet Metal - Gross Material Usage (Nesting)');

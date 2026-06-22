-- Migration 173: Sheet Metal Process Calculators
--
-- Adds two global calculators for sheet metal manufacturing.
-- Does NOT touch the valid_data_source constraint — all fields use
-- 'manual', 'mhr', 'lhr', or 'processes' (valid values).
-- The perimeter_mm / pierce_count values are declared as 'manual' with
-- default 0; calculator-executor.ts overwrites them with real geometry
-- values at runtime (perimeter = 2×(L+W), pierce = holeCount+1).
--
-- Calculators added:
--   Laser Cut Time Calculator   — geometry-driven via perimeter_mm + pierce_count
--   Press Brake Time Calculator — AI-supplied cycle_time (bend_count × 30s / 60)
--
-- Formula chain (Laser Cut):
--   cut_time_min      = perimeter_mm / machine_speed_mm_per_min
--   pierce_time_min   = (pierce_count × pierce_time_sec_each) / 60
--   cycle_time_total  = cut_time_min + pierce_time_min
--   setup_cost        = setup_time × (machine_rate + labour_rate × setup_manning) / (60 × batch_size)
--   cycle_cost        = cycle_time_total × (machine_rate + labour_rate × heads) / 60
--   cost_per_part     = setup_cost + cycle_cost   ← PRIMARY (INR)
--
-- Formula chain (Press Brake):
--   setup_cost        = setup_time × (machine_rate + labour_rate × setup_manning) / (60 × batch_size)
--   cycle_cost        = cycle_time × (machine_rate + labour_rate × heads) / (60 × parts_per_cycle)
--   cost_per_part     = setup_cost + cycle_cost   ← PRIMARY (INR)
--
-- Safe to re-run — INSERT is skipped if the calculator already exists with is_global = TRUE.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_uid    UUID;
  v_laser  UUID;
  v_brake  UUID;
BEGIN

  SELECT id INTO v_uid FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'Migration 173: no users found — skipping calculator seed';
    RETURN;
  END IF;

  -- ── 1. Laser Cut Time Calculator ─────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM calculators
    WHERE name = 'Laser Cut Time Calculator' AND is_global = TRUE
  ) THEN

    INSERT INTO calculators (
      user_id, name, description,
      calc_category, calculator_type,
      is_template, is_public, is_global,
      display_config, version
    ) VALUES (
      v_uid,
      'Laser Cut Time Calculator',
      'Geometry-based laser cutting cost estimator. '
      'perimeter_mm and pierce_count are auto-injected from part geometry (no DXF needed). '
      'Adjust machine_speed_mm_per_min and pierce_time_sec_each for your machine + material: '
      '3mm MS fiber 3kW ≈ 4000 mm/min; 6mm MS ≈ 2000; 3mm SS ≈ 2500; 3mm Al ≈ 5000. '
      'pierce_time_sec_each: 3mm MS ≈ 1.5 s; 6mm MS ≈ 3 s.',
      'process', 'multi_step',
      FALSE, FALSE, TRUE,
      '{}'::jsonb, 1
    ) RETURNING id INTO v_laser;

    -- Fields: mhr/lhr/processes are resolved by the executor from the candidate set.
    -- perimeter_mm and pierce_count use 'manual' data_source with default 0; the executor
    -- overwrites them with real geometry values (perimeter = 2×(L+W), pierce = holeCount+1).
    -- machine_speed and pierce_time are 'manual' constants the user can tune per machine.
    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type,
       data_source, source_field, default_value, is_required, display_order)
    VALUES
      (v_laser, 'machine_rate',             'Machine Rate (₹/hr)',           'number', 'mhr',      'total_machine_hour_rate', '0',    TRUE,  1),
      (v_laser, 'labour_rate',              'Labour Rate (₹/hr)',            'number', 'lhr',      'total_lhr',               '0',    TRUE,  2),
      (v_laser, 'setup_time',               'Setup Time (min)',               'number', 'processes','setup_time_minutes',      '15',   FALSE, 3),
      (v_laser, 'perimeter_mm',             'Cut Perimeter (mm) [auto]',     'number', 'manual',   NULL,                      '0',    FALSE, 4),
      (v_laser, 'pierce_count',             'Pierce Count [auto]',           'number', 'manual',   NULL,                      '1',    FALSE, 5),
      (v_laser, 'machine_speed_mm_per_min', 'Cut Speed (mm/min)',             'number', 'manual',   NULL,                      '4000', FALSE, 6),
      (v_laser, 'pierce_time_sec_each',     'Pierce Time per Pierce (sec)',   'number', 'manual',   NULL,                      '1.5',  FALSE, 7);

    INSERT INTO calculator_formulas
      (calculator_id, formula_name, display_label,
       formula_expression, formula_type,
       execution_order, is_primary_result, display_in_results,
       decimal_places, display_format)
    VALUES
      (v_laser,
       'cut_time_min', 'Cut Travel Time (min)',
       'perimeter_mm / machine_speed_mm_per_min',
       'expression', 1, FALSE, TRUE, 3, 'number'),

      (v_laser,
       'pierce_time_min', 'Pierce Time (min)',
       '(pierce_count * pierce_time_sec_each) / 60',
       'expression', 2, FALSE, TRUE, 3, 'number'),

      (v_laser,
       'cycle_time_total', 'Total Cycle Time (min)',
       'cut_time_min + pierce_time_min',
       'expression', 3, FALSE, TRUE, 3, 'number'),

      (v_laser,
       'setup_cost', 'Setup Cost per Part (₹)',
       '(setup_time * (machine_rate + labour_rate * setup_manning)) / (60 * batch_size)',
       'expression', 4, FALSE, TRUE, 2, 'currency'),

      (v_laser,
       'cycle_cost', 'Cycle Cost per Part (₹)',
       '(cycle_time_total * (machine_rate + labour_rate * heads)) / 60',
       'expression', 5, FALSE, TRUE, 2, 'currency'),

      (v_laser,
       'cost_per_part', 'Total Laser Cut Cost per Part (₹)',
       'setup_cost + cycle_cost',
       'expression', 6, TRUE, TRUE, 2, 'currency');

    RAISE NOTICE 'Migration 173: created Laser Cut Time Calculator (%)', v_laser;
  ELSE
    SELECT id INTO v_laser FROM calculators
    WHERE name = 'Laser Cut Time Calculator' AND is_global = TRUE;
    RAISE NOTICE 'Migration 173: Laser Cut Time Calculator already exists (%)', v_laser;
  END IF;

  -- ── 2. Press Brake Time Calculator ───────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM calculators
    WHERE name = 'Press Brake Time Calculator' AND is_global = TRUE
  ) THEN

    INSERT INTO calculators (
      user_id, name, description,
      calc_category, calculator_type,
      is_template, is_public, is_global,
      display_config, version
    ) VALUES (
      v_uid,
      'Press Brake Time Calculator',
      'Cost per part for CNC press brake bending. '
      'AI supplies cycle_time = bend_count × 30 s / 60 (adjust for complex tooling). '
      'Same setup/cycle chain as drilling and tapping calculators.',
      'process', 'multi_step',
      FALSE, FALSE, TRUE,
      '{}'::jsonb, 1
    ) RETURNING id INTO v_brake;

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type,
       data_source, source_field, default_value, is_required, display_order)
    VALUES
      (v_brake, 'machine_rate', 'Machine Rate (₹/hr)',  'number', 'mhr',      'total_machine_hour_rate', '0',  TRUE,  1),
      (v_brake, 'labour_rate',  'Labour Rate (₹/hr)',   'number', 'lhr',      'total_lhr',               '0',  TRUE,  2),
      (v_brake, 'setup_time',   'Setup Time (min)',      'number', 'processes','setup_time_minutes',      '20', FALSE, 3),
      (v_brake, 'cycle_time',   'Cycle Time (min)',      'number', 'processes','cycle_time_minutes',      '1',  FALSE, 4);

    INSERT INTO calculator_formulas
      (calculator_id, formula_name, display_label,
       formula_expression, formula_type,
       execution_order, is_primary_result, display_in_results,
       decimal_places, display_format)
    VALUES
      (v_brake,
       'setup_cost', 'Setup Cost per Part (₹)',
       '(setup_time * (machine_rate + labour_rate * setup_manning)) / (60 * batch_size)',
       'expression', 1, FALSE, TRUE, 2, 'currency'),

      (v_brake,
       'cycle_cost', 'Cycle Cost per Part (₹)',
       '(cycle_time * (machine_rate + labour_rate * heads)) / (60 * parts_per_cycle)',
       'expression', 2, FALSE, TRUE, 2, 'currency'),

      (v_brake,
       'cost_per_part', 'Total Press Brake Cost per Part (₹)',
       'setup_cost + cycle_cost',
       'expression', 3, TRUE, TRUE, 2, 'currency');

    RAISE NOTICE 'Migration 173: created Press Brake Time Calculator (%)', v_brake;
  ELSE
    SELECT id INTO v_brake FROM calculators
    WHERE name = 'Press Brake Time Calculator' AND is_global = TRUE;
    RAISE NOTICE 'Migration 173: Press Brake Time Calculator already exists (%)', v_brake;
  END IF;

  RAISE NOTICE 'Migration 173 complete. Laser=%, PressB=%', v_laser, v_brake;

END $$;

-- ── Verify ─────────────────────────────────────────────────────────────────────
-- SELECT c.name, c.calc_category, c.is_global,
--   COUNT(DISTINCT f.id) AS fields, COUNT(DISTINCT fm.id) AS formulas
-- FROM calculators c
-- LEFT JOIN calculator_fields f   ON f.calculator_id  = c.id
-- LEFT JOIN calculator_formulas fm ON fm.calculator_id = c.id
-- WHERE c.name IN ('Laser Cut Time Calculator','Press Brake Time Calculator')
-- GROUP BY c.id, c.name, c.calc_category, c.is_global;

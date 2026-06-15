-- Migration 171: Seed operation-specific calculators
--
-- Adds three global calculators that the AI process-plan generator selects for
-- hole and thread operations. Before this migration the AI fell back to the
-- generic "Milling Center Calculator" or "Turning Center Calculator" for these
-- ops, which caused cycle-time errors and 18× cost overestimates.
--
-- Calculators added:
--   CNC Drilling Calculator    — drilling on lathe (live tool) or VMC/drill press
--   Thread Tapping Calculator  — rigid tapping on lathe or VMC
--   Thread Milling Calculator  — helical-interpolation thread milling on VMC
--
-- Formula design (identical structure for all three):
--
--   setup_cost   = (setup_time × (machine_rate + labour_rate × setup_manning))
--                  / (60 × batch_size)
--
--   cycle_cost   = (cycle_time × (machine_rate + labour_rate × heads))
--                  / (60 × parts_per_cycle)
--
--   cost_per_part = setup_cost + cycle_cost          ← PRIMARY RESULT (INR)
--
-- Units:
--   machine_rate / labour_rate — INR/hr  (from MHR / LHR candidates)
--   setup_time / cycle_time    — minutes (cycle_time = resolver's cycleSec / 60)
--   The /60 factor converts rate from per-hour to per-minute.
--
-- The resolver pre-resolves cycleSec from the AI's cycleSec hint before
-- calling the calculator, so no geometry lookup is required here.
--
-- is_global = TRUE makes these visible to all tenants (same RLS policy as
-- global MHR / LSR records). user_id is set to the first auth user found;
-- it is irrelevant once is_global is true.
--
-- Safe to re-run: INSERT is skipped if the calculator name already exists
-- with is_global = TRUE.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_uid    UUID;
  v_drill  UUID;
  v_tap    UUID;
  v_thread UUID;
BEGIN

  -- Resolve owner (any user; tenancy is satisfied by is_global = TRUE)
  SELECT id INTO v_uid FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'Migration 171: no users found — skipping calculator seed';
    RETURN;
  END IF;

  -- ── 1. CNC Drilling Calculator ──────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM calculators
    WHERE name = 'CNC Drilling Calculator' AND is_global = TRUE
  ) THEN

    INSERT INTO calculators (
      user_id, name, description,
      calc_category, calculator_type,
      is_template, is_public, is_global,
      display_config, version
    ) VALUES (
      v_uid,
      'CNC Drilling Calculator',
      'Cost per part for CNC drilling operations (lathe live-tool, VMC, or drill press). '
      'cycle_time supplied by the AI in minutes, estimated from: '
      'hole_depth / (feed_per_rev × rpm) × hole_count. '
      'Two-formula chain: setup_cost → cycle_cost → cost_per_part (INR, primary).',
      'process', 'multi_step',
      FALSE, FALSE, TRUE,
      '{}'::jsonb, 1
    ) RETURNING id INTO v_drill;

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type,
       data_source, source_field, default_value, is_required, display_order)
    VALUES
      (v_drill, 'machine_rate',  'Machine Rate (₹/hr)',  'number', 'mhr',      'total_machine_hour_rate', '0',  TRUE,  1),
      (v_drill, 'labour_rate',   'Labour Rate (₹/hr)',   'number', 'lhr',      'total_lhr',               '0',  TRUE,  2),
      (v_drill, 'setup_time',    'Setup Time (min)',      'number', 'processes','setup_time_minutes',      '15', FALSE, 3),
      (v_drill, 'cycle_time',    'Cycle Time (min)',      'number', 'processes','cycle_time_minutes',      '2',  FALSE, 4);
    -- batch_size, heads, setup_manning, parts_per_cycle are auto-injected by
    -- calculator-executor.ts from the resolver params — no manual fields needed.

    INSERT INTO calculator_formulas
      (calculator_id, formula_name, display_label,
       formula_expression, formula_type,
       execution_order, is_primary_result, display_in_results,
       decimal_places, display_format)
    VALUES
      (v_drill,
       'setup_cost', 'Setup Cost per Part (₹)',
       '(setup_time * (machine_rate + labour_rate * setup_manning)) / (60 * batch_size)',
       'expression', 1, FALSE, TRUE, 2, 'currency'),

      (v_drill,
       'cycle_cost', 'Cycle Cost per Part (₹)',
       '(cycle_time * (machine_rate + labour_rate * heads)) / (60 * parts_per_cycle)',
       'expression', 2, FALSE, TRUE, 2, 'currency'),

      (v_drill,
       'cost_per_part', 'Total Drilling Cost per Part (₹)',
       'setup_cost + cycle_cost',
       'expression', 3, TRUE, TRUE, 2, 'currency');

    RAISE NOTICE 'Migration 171: created CNC Drilling Calculator (%)', v_drill;
  ELSE
    SELECT id INTO v_drill
    FROM calculators WHERE name = 'CNC Drilling Calculator' AND is_global = TRUE;
    RAISE NOTICE 'Migration 171: CNC Drilling Calculator already exists (%)', v_drill;
  END IF;

  -- ── 2. Thread Tapping Calculator ────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM calculators
    WHERE name = 'Thread Tapping Calculator' AND is_global = TRUE
  ) THEN

    INSERT INTO calculators (
      user_id, name, description,
      calc_category, calculator_type,
      is_template, is_public, is_global,
      display_config, version
    ) VALUES (
      v_uid,
      'Thread Tapping Calculator',
      'Cost per part for rigid tapping operations on CNC lathe or VMC. '
      'cycle_time supplied by AI in minutes, estimated from: '
      '(thread_depth / (pitch × rpm)) × 2 × hole_count — factor 2 for retract pass. '
      'Two-formula chain: setup_cost → cycle_cost → cost_per_part (INR, primary).',
      'process', 'multi_step',
      FALSE, FALSE, TRUE,
      '{}'::jsonb, 1
    ) RETURNING id INTO v_tap;

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type,
       data_source, source_field, default_value, is_required, display_order)
    VALUES
      (v_tap, 'machine_rate',  'Machine Rate (₹/hr)',  'number', 'mhr',      'total_machine_hour_rate', '0',  TRUE,  1),
      (v_tap, 'labour_rate',   'Labour Rate (₹/hr)',   'number', 'lhr',      'total_lhr',               '0',  TRUE,  2),
      (v_tap, 'setup_time',    'Setup Time (min)',      'number', 'processes','setup_time_minutes',      '20', FALSE, 3),
      (v_tap, 'cycle_time',    'Cycle Time (min)',      'number', 'processes','cycle_time_minutes',      '1',  FALSE, 4);

    INSERT INTO calculator_formulas
      (calculator_id, formula_name, display_label,
       formula_expression, formula_type,
       execution_order, is_primary_result, display_in_results,
       decimal_places, display_format)
    VALUES
      (v_tap,
       'setup_cost', 'Setup Cost per Part (₹)',
       '(setup_time * (machine_rate + labour_rate * setup_manning)) / (60 * batch_size)',
       'expression', 1, FALSE, TRUE, 2, 'currency'),

      (v_tap,
       'cycle_cost', 'Cycle Cost per Part (₹)',
       '(cycle_time * (machine_rate + labour_rate * heads)) / (60 * parts_per_cycle)',
       'expression', 2, FALSE, TRUE, 2, 'currency'),

      (v_tap,
       'cost_per_part', 'Total Tapping Cost per Part (₹)',
       'setup_cost + cycle_cost',
       'expression', 3, TRUE, TRUE, 2, 'currency');

    RAISE NOTICE 'Migration 171: created Thread Tapping Calculator (%)', v_tap;
  ELSE
    SELECT id INTO v_tap
    FROM calculators WHERE name = 'Thread Tapping Calculator' AND is_global = TRUE;
    RAISE NOTICE 'Migration 171: Thread Tapping Calculator already exists (%)', v_tap;
  END IF;

  -- ── 3. Thread Milling Calculator ────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM calculators
    WHERE name = 'Thread Milling Calculator' AND is_global = TRUE
  ) THEN

    INSERT INTO calculators (
      user_id, name, description,
      calc_category, calculator_type,
      is_template, is_public, is_global,
      display_config, version
    ) VALUES (
      v_uid,
      'Thread Milling Calculator',
      'Cost per part for thread milling on VMC (external threads and precision internal). '
      'cycle_time supplied by AI in minutes, estimated from: '
      '(thread_length / pitch) × 3 / 60 — approximately 3 s per helical pass. '
      'Two-formula chain: setup_cost → cycle_cost → cost_per_part (INR, primary).',
      'process', 'multi_step',
      FALSE, FALSE, TRUE,
      '{}'::jsonb, 1
    ) RETURNING id INTO v_thread;

    INSERT INTO calculator_fields
      (calculator_id, field_name, display_label, field_type,
       data_source, source_field, default_value, is_required, display_order)
    VALUES
      (v_thread, 'machine_rate',  'Machine Rate (₹/hr)',  'number', 'mhr',      'total_machine_hour_rate', '0',  TRUE,  1),
      (v_thread, 'labour_rate',   'Labour Rate (₹/hr)',   'number', 'lhr',      'total_lhr',               '0',  TRUE,  2),
      (v_thread, 'setup_time',    'Setup Time (min)',      'number', 'processes','setup_time_minutes',      '20', FALSE, 3),
      (v_thread, 'cycle_time',    'Cycle Time (min)',      'number', 'processes','cycle_time_minutes',      '2',  FALSE, 4);

    INSERT INTO calculator_formulas
      (calculator_id, formula_name, display_label,
       formula_expression, formula_type,
       execution_order, is_primary_result, display_in_results,
       decimal_places, display_format)
    VALUES
      (v_thread,
       'setup_cost', 'Setup Cost per Part (₹)',
       '(setup_time * (machine_rate + labour_rate * setup_manning)) / (60 * batch_size)',
       'expression', 1, FALSE, TRUE, 2, 'currency'),

      (v_thread,
       'cycle_cost', 'Cycle Cost per Part (₹)',
       '(cycle_time * (machine_rate + labour_rate * heads)) / (60 * parts_per_cycle)',
       'expression', 2, FALSE, TRUE, 2, 'currency'),

      (v_thread,
       'cost_per_part', 'Total Thread Milling Cost per Part (₹)',
       'setup_cost + cycle_cost',
       'expression', 3, TRUE, TRUE, 2, 'currency');

    RAISE NOTICE 'Migration 171: created Thread Milling Calculator (%)', v_thread;
  ELSE
    SELECT id INTO v_thread
    FROM calculators WHERE name = 'Thread Milling Calculator' AND is_global = TRUE;
    RAISE NOTICE 'Migration 171: Thread Milling Calculator already exists (%)', v_thread;
  END IF;

  RAISE NOTICE 'Migration 171 complete. Drilling=%, Tapping=%, Thread Milling=%',
    v_drill, v_tap, v_thread;

END $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Uncomment after running:
-- SELECT
--   c.name,
--   c.calc_category,
--   c.is_global,
--   COUNT(DISTINCT f.id)  AS fields,
--   COUNT(DISTINCT fm.id) AS formulas
-- FROM calculators c
-- LEFT JOIN calculator_fields f  ON f.calculator_id  = c.id
-- LEFT JOIN calculator_formulas fm ON fm.calculator_id = c.id
-- WHERE c.name IN (
--   'CNC Drilling Calculator',
--   'Thread Tapping Calculator',
--   'Thread Milling Calculator'
-- )
-- GROUP BY c.id, c.name, c.calc_category, c.is_global;

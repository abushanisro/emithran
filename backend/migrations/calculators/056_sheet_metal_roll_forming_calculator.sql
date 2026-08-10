-- ============================================================================
-- Calculator: Sheet Metal - Roll Forming
-- Category:   Process
-- Closes the Roll Forming gap found while auditing Sheet Metal's
-- Bending/Floating /Forming route (machine_class='roll_forming' has had a
-- process_calculator_mappings row since migration 368 but no calculator was
-- ever built or linked).
--
-- Real, sourced physics (see this session's research; sources below):
--   Cycle Time = Part Length / Line Speed
-- This is confirmed real manufacturing physics for continuous roll forming —
-- all roll stands act on the moving strip simultaneously, not sequentially
-- with per-stand dwell time, so cycle time depends only on line speed and
-- part length, not stand/pass count (ASM International / AHSS Guidelines;
-- The Fabricator, "Continuous improvement for roll forming": cycle time is
-- set by "the achievable line speed of the slowest process in the line").
--
-- Line Speed default: no single vendor/handbook source publishes a per-
-- material/thickness speed table (real vendor lines range 40-400 fpm
-- depending on product/gauge/material — Samco, Bradbury, Formtek, SUNWAY —
-- but none of those figures come from a controlled, comparable study, so
-- blending them into fabricated "tiers" would misrepresent the sourcing).
-- Instead this uses the one real, disclosed, general "achievable shop-floor
-- throughput" figure found: "smaller operations net only ~100-110 fpm even
-- on 150 fpm-rated lines" (Rollforming Magazine, "Do You Need a High-Speed
-- Roll Former, or Can You Get More with What You've Got?",
-- rollformingmagazine.com) — ≈30.5 m/min. Disclosed as an engineering-
-- standard assumption (not exact-part-specific), same convention as this
-- app's other generic-default fields — a real caller with a real, measured
-- line speed for a specific machine/profile overrides this input directly.
--
-- Setup Time default: 20 min — midpoint of Formtek's real, cited "~15 min/
-- pass for conventional small mills (1.5-2in spindle), ~20 min/pass for
-- 2.5-3in mills" (Formtek Group blog, "Roll Forming Line Operation and
-- Setup", blog.formtekgroup.com).
--
-- Formulas:
--   Cycle Time (s) = (Part Length / 1000 / Line Speed) * 60
-- Run in: Supabase SQL Editor
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
  v_user_id UUID := '5572f34d-2f51-456e-a5d7-96f840128b50';
BEGIN
  INSERT INTO calculators (
    user_id, name, calc_category, calculator_type, is_template, is_public, description
  ) VALUES (
    v_user_id,
    'Sheet Metal - Roll Forming',
    'sheet_metal',
    'single',
    false,
    false,
    'Roll Forming – real continuous-forming physics (Cycle Time = Part Length / Line Speed), sourced setup time, wired into the registry/trace/gap pipeline'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',       'MHR/hour',        'number', '/hr', NULL, 1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',       'LHR/hour',        'number', '/hr', NULL, 2, false, '96.14'),
    (v_calc_id, 'OLE',                'OLE (%)',         'number', '%',  NULL, 3, false, '80'),

    (v_calc_id, 'Part Length',        'Part Length (mm)',        'number', 'mm',    NULL, 4, false, NULL),
    (v_calc_id, 'Line Speed',         'Line Speed (m/min)',      'number', 'm/min', NULL, 5, false, '30.5'),
    (v_calc_id, 'Setup Time',         'Setup Time (min)',        'number', 'min',   NULL, 6, false, '20'),

    (v_calc_id, 'Cycle Time',         'Cycle Time (s)',          'calculated', 's',   NULL, 7, false, NULL),
    (v_calc_id, 'Machine Cost',       'Machine Cost',            'calculated', NULL,  NULL, 8, false, NULL),
    (v_calc_id, 'Labour Cost',        'Labour Cost',              'calculated', NULL,  NULL, 9, false, NULL),
    (v_calc_id, 'Process Cost',       'Process Cost',             'calculated', NULL,  NULL, 10, false, NULL);

  UPDATE calculator_fields SET default_value = '(({Part Length} / 1000) / {Line Speed}) * 60'
  WHERE calculator_id = v_calc_id AND field_name = 'Cycle Time';

  UPDATE calculator_fields SET default_value = '{MHR per Hour} * {Cycle Time} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value = '{LHR per Hour} * {Cycle Time} / (3600 * ({OLE} / 100))'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  UPDATE calculator_fields SET default_value = '{Machine Cost} + {Labour Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Process Cost';

  -- Link into process_calculator_mappings — migration 368 assigned
  -- machine_class='roll_forming' to the Sheet Metal 'Roll Forming' row but
  -- never linked a calculator (confirmed: no prior migration sets
  -- calculator_id for this machine_class).
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'roll_forming'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Sheet Metal Roll Forming, ID: %', v_calc_id;
END $$;

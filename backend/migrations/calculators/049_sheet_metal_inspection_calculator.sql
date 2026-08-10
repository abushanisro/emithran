-- ============================================================================
-- Calculator: Sheet Metal - Inspection (2026-08-07)
-- Category:   Process
--
-- Root cause: the Inspection process line's Cycle Time calculator popup showed
-- "Choose a calculator" — no calculator was ever mapped for machine_class='cmm',
-- because inspection cycle time is computed by a real, tiered engine
-- (costing/inspection-engine.ts: sampling strategy + method escalation +
-- per-feature time), not a simple formula — unlike Tapping/Press Brake, which
-- already have one. User explicitly wants this calculator-driven, not just a
-- silently-prefilled field.
--
-- Deliberately does NOT re-implement sampling/method-escalation here — that
-- decision logic (which features get sampled, which method a GD&T/tolerance
-- callout escalates to) stays owned by inspection-engine.ts, the same single
-- source of truth the cost engine itself uses. This calculator's fields are
-- the ALREADY-RESOLVED outputs of that engine (feature counts post-sampling,
-- per-feature times for the resolved method) — exactly the same numbers
-- already shown in the "Feature breakdown" panel — and its formula is just
-- the same additive sum inspection-engine.ts's own totalSec already computes
-- (visual base + holes×hole-time + bends×bend-time + threads×thread-time +
-- thickness check + dimension check). Wired by ProcessCostDialog.tsx from
-- the real engine's featureBreakdown, not re-typed by hand.
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
    'Sheet Metal - Inspection',
    'process',
    'single',
    false,
    false,
    'Inspection cycle time from real, already-sampled feature counts and method-resolved per-feature times (see costing/inspection-engine.ts) — full cost breakdown'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',        'MHR/hour',                     'number', '/hr', NULL,  1, false, '0'),
    (v_calc_id, 'LHR per Hour',        'LHR/hour',                     'number', '/hr', NULL,  2, false, '0'),
    (v_calc_id, 'Method',              'Resolved Method',              'text',   NULL,  NULL,  3, false, 'visual'),

    (v_calc_id, 'Visual Pass Base',    'Visual Pass Base (sec)',       'number', 's',   NULL,  4, false, '0'),
    (v_calc_id, 'Holes to Inspect',    'Holes to Inspect (sampled)',   'number', NULL,  NULL,  5, false, '0'),
    (v_calc_id, 'Hole Check Time',     'Hole Check Time (sec/hole)',   'number', 's',   NULL,  6, false, '0'),
    (v_calc_id, 'Bends to Inspect',    'Bends to Inspect (sampled)',   'number', NULL,  NULL,  7, false, '0'),
    (v_calc_id, 'Bend Check Time',     'Bend Check Time (sec/bend)',   'number', 's',   NULL,  8, false, '0'),
    (v_calc_id, 'Threads to Inspect',  'Threads to Inspect (sampled)', 'number', NULL,  NULL,  9, false, '0'),
    (v_calc_id, 'Thread Gauge Time',   'Thread Gauge Time (sec/thread)','number', 's',  NULL, 10, false, '0'),
    (v_calc_id, 'Has Thickness Check', 'Thickness Check Present (0/1)','number', NULL,  NULL, 11, false, '0'),
    (v_calc_id, 'Thickness Check Time','Thickness Check Time (sec)',   'number', 's',   NULL, 12, false, '0'),
    (v_calc_id, 'Has Dimension Check', 'Dimension Check Present (0/1)','number', NULL,  NULL, 13, false, '0'),
    (v_calc_id, 'Dimension Check Time','Dimension Check Time (sec)',   'number', 's',   NULL, 14, false, '0'),

    (v_calc_id, 'Total Time',          'Total Time (s)',               'calculated', 's',   NULL, 15, false, NULL),
    (v_calc_id, 'Total Time Min',      'Total Time (min)',             'calculated', 'min', NULL, 16, false, NULL),
    (v_calc_id, 'Machine Cost',        'Machine Cost',                 'calculated', NULL,  NULL, 17, false, NULL),
    (v_calc_id, 'Labour Cost',         'Labour Cost',                  'calculated', NULL,  NULL, 18, false, NULL),
    (v_calc_id, 'Total Process Cost',  'Total Process Cost',           'calculated', NULL,  NULL, 19, false, NULL);

  -- Same additive structure as inspection-engine.ts's own totalSec — see
  -- migration header. Every term here is a real, caller-supplied value
  -- (feature-breakdown count/timeSec pairs), not an invented constant.
  UPDATE calculator_fields SET default_value =
    '{Visual Pass Base} + {Holes to Inspect} * {Hole Check Time} + {Bends to Inspect} * {Bend Check Time} + {Threads to Inspect} * {Thread Gauge Time} + {Has Thickness Check} * {Thickness Check Time} + {Has Dimension Check} * {Dimension Check Time}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Time';

  UPDATE calculator_fields SET default_value = '{Total Time} / 60'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Time Min';

  UPDATE calculator_fields SET default_value = '{MHR per Hour} * {Total Time} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value = '{LHR per Hour} * {Total Time} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  UPDATE calculator_fields SET default_value = '{Machine Cost} + {Labour Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Process Cost';

  -- Wire every active cmm-class Inspection operation to this calculator —
  -- Inspection exists under multiple process groups (Sheet Metal, Post
  -- Processing, Injection Molding) with different operation names, all the
  -- same real engine and same real fields.
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'cmm' AND is_active = true;

  RAISE NOTICE 'Done — Sheet Metal Inspection calculator, ID: %', v_calc_id;
END $$;

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT id, name FROM calculators WHERE name = 'Sheet Metal - Inspection';
-- SELECT process_group, process_route, operation, calculator_id FROM process_calculator_mappings
--   WHERE machine_class = 'cmm';

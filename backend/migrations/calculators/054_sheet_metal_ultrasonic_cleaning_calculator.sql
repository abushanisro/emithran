-- ============================================================================
-- Calculator: Post Processing - Ultrasonic Cleaning
-- Category:   Process
-- Closes task #114 (Manufacturing Physics Calculator architecture) — the
-- machine_class='cleaning' row (migration 425: Post Processing / Cleaning /
-- Ultrasonic Cleaning) has had real MHR rate data since it was created, but
-- calculator_id was left NULL — no calculator existed at all until now.
--
-- Real, sourced formula: an ultrasonic bath cleans every part in its basket
-- in ONE bath cycle regardless of how many parts share the basket — the
-- bath time is a per-BATCH quantity, amortized across the lot, the same
-- convention "Lot Size" already uses in "Sheet Metal - Bending
-- Manufacturing"'s own Stroke Time / Lot Size relationship. Bath time by
-- soiling/complexity tier comes from sm_lookup_cleaning_time (migration 432,
-- EXACT_MATCH policy, real sourced industry-published ranges — see that
-- migration's own citations), resolved by the caller (bom-items.service.ts)
-- and fed in as a plain input, same convention as every other lookup-fed
-- field in this registry (e.g. "Sheet Metal - Bending Manufacturing"'s own
-- 'Stroke Time Per Bend').
--
-- Formula:
--   Cleaning Time Per Part = Batch Cleaning Time / Lot Size
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
    'Post Processing - Ultrasonic Cleaning',
    'process',
    'single',
    false,
    false,
    'Ultrasonic Cleaning – real sm_lookup_cleaning_time bath-time lookup (by soiling/complexity tier), amortized per-batch across Lot Size, wired into the registry/trace/gap pipeline'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',            'MHR/hour (INR/hr)',           'number', 'INR/hr', NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',            'LHR/hour (INR/hr)',           'number', 'INR/hr', NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                     'OLE (%)',                     'number', '%',      NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',        'Setup Percentage (%)',        'number', '%',      NULL,  4, false, '30'),

    (v_calc_id, 'Batch Cleaning Time',     'Batch Cleaning Time (s)',     'number', 's',      NULL,  5, false, NULL),
    (v_calc_id, 'Lot Size',                'Lot Size',                    'number', NULL,     NULL,  6, false, '1'),

    (v_calc_id, 'Cleaning Time Per Part',  'Cleaning Time Per Part (s)',  'calculated', 's',   NULL,  7, false, NULL),
    (v_calc_id, 'Machine Cost',            'Machine Cost (INR)',          'calculated', 'INR', NULL,  8, false, NULL),
    (v_calc_id, 'Labour Cost',             'Labour Cost (INR)',           'calculated', 'INR', NULL,  9, false, NULL),
    (v_calc_id, 'Process Cost',            'Process Cost (INR)',          'calculated', 'INR', NULL, 10, false, NULL),
    (v_calc_id, 'Setup Cost',              'Setup Cost (INR)',            'calculated', 'INR', NULL, 11, false, NULL),
    (v_calc_id, 'Total Process Cost',      'Total Process Cost (INR)',    'calculated', 'INR', NULL, 12, false, NULL);

  UPDATE calculator_fields SET default_value = '{Batch Cleaning Time} / {Lot Size}'
  WHERE calculator_id = v_calc_id AND field_name = 'Cleaning Time Per Part';

  UPDATE calculator_fields SET default_value = '{MHR per Hour} * {Cleaning Time Per Part} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value = '{LHR per Hour} * {Cleaning Time Per Part} / (3600 * ({OLE} / 100))'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  UPDATE calculator_fields SET default_value = '{Machine Cost} + {Labour Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Process Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} * ({Setup Percentage} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} + {Setup Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Process Cost';

  -- Link into process_calculator_mappings — migration 425's row
  -- (machine_class='cleaning') has had calculator_id NULL since it was
  -- created; this is the first calculator ever registered for it.
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'cleaning'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Post Processing Ultrasonic Cleaning, ID: %', v_calc_id;
END $$;

-- ============================================================================
-- Calculator: Sheet Metal - PEM Insertion
-- Category:   Process
-- Wraps the REAL, already-existing sm_lookup_pem_hardware diameter+thickness
-- matched insertion-cycle-time lookup (previously read directly by
-- bom-items.service.ts/cost-engine.ts) so PEM Insertion goes through the same
-- registry/trace/gap pipeline as every other migrated process.
--
-- PEM insertion time is a pure hardware-spec lookup (no RPM/feed physics —
-- the press stroke time is a property of the specific PEM part, not a cutting
-- operation) — 'Insertion Cycle Time' is fed in by the caller, already
-- resolved from sm_lookup_pem_hardware (real, part-number-specific data);
-- this calculator cannot query that table itself (formula strings have no
-- DB access). A hole diameter that matches no PEM hardware spec is a
-- recognition result (not a PEM insertion point), not a lookup gap — the
-- caller only calls this calculator for groups that DID match.
--
-- Formula:
--   Total Time = No Of Insertions * Insertion Cycle Time
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
    'Sheet Metal - PEM Insertion',
    'process',
    'single',
    false,
    false,
    'PEM Insertion – wraps the real sm_lookup_pem_hardware insertion-cycle-time lookup in the registry/trace pipeline'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',         'MHR/hour (INR/hr)',       'number', 'INR/hr', NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',         'LHR/hour (INR/hr)',       'number', 'INR/hr', NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                  'OLE (%)',                 'number', '%',      NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',     'Setup Percentage (%)',    'number', '%',      NULL,  4, false, '30'),

    (v_calc_id, 'Insertion Cycle Time', 'Insertion Cycle Time (s)', 'number', 's',    NULL,  5, false, NULL),
    (v_calc_id, 'No Of Insertions',     'No. of Insertions',        'number', NULL,   NULL,  6, false, '1'),

    (v_calc_id, 'Total Time',           'Total Time (s)',           'calculated', 's',   NULL, 7, false, NULL),
    (v_calc_id, 'Machine Cost',         'Machine Cost (INR)',       'calculated', 'INR', NULL, 8, false, NULL),
    (v_calc_id, 'Labour Cost',          'Labour Cost (INR)',        'calculated', 'INR', NULL, 9, false, NULL),
    (v_calc_id, 'Process Cost',         'Process Cost (INR)',       'calculated', 'INR', NULL, 10, false, NULL),
    (v_calc_id, 'Setup Cost',           'Setup Cost (INR)',         'calculated', 'INR', NULL, 11, false, NULL),
    (v_calc_id, 'Total Process Cost',   'Total Process Cost (INR)', 'calculated', 'INR', NULL, 12, false, NULL);

  UPDATE calculator_fields SET default_value = '{No Of Insertions} * {Insertion Cycle Time}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Time';

  UPDATE calculator_fields SET default_value = '{MHR per Hour} * {Total Time} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value = '{LHR per Hour} * {Total Time} / (3600 * ({OLE} / 100))'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  UPDATE calculator_fields SET default_value = '{Machine Cost} + {Labour Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Process Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} * ({Setup Percentage} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} + {Setup Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Process Cost';

  -- Link into process_calculator_mappings — the row for machine_class=
  -- 'pem_press' (migration 381) has calculator_id NULL today (confirmed
  -- live; calculator_name is the descriptive-only 'PEM Insertion Calculator',
  -- matching no real calculator).
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'pem_press'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Sheet Metal PEM Insertion, ID: %', v_calc_id;
END $$;

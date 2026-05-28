-- ============================================================================
-- Calculator: Machining - Inspection
-- Category:   Process
-- Fields:     19 (7 W/C inputs — MHR defaults to 0 for inspection, 2 process, 10 calculated)
-- Formulas:
--   Time per Part (s) = Batch Time / Batch Size
--   Machine Cost      = 0  (MHR = 0 — no machine used for inspection)
--   Labour Cost       = LHR per Hour × Time per Part / (3600 × OLE/100)
--   Process Cost      = Machine Cost + Labour Cost + Tool Cost per Part
--   Setup Cost        = Process Cost × Setup Percentage / 100
--   Total Process Cost = Process Cost + Setup Cost
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
    'Machining - Inspection',
    'process',
    'single',
    false,
    false,
    'Inspection – batch time / batch size per part, labour-only cost (no machine), setup cost, total process cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- MHR = 0 for inspection (no machine)
    (v_calc_id, 'MHR per Hour',       'MHR/hour (INR/hr) — 0 for inspection', 'number', 'INR/hr', NULL,  1, false, '0'),
    (v_calc_id, 'LHR per Hour',       'LHR/hour (INR/hr)',                     'number', 'INR/hr', NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                'OLE (%)',                               'number', '%',      NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',   'Setup Percentage (%)',                  'number', '%',      NULL,  4, false, '30'),
    (v_calc_id, 'Tool Code',          'Tool Code',                             'text',   NULL,     NULL,  5, false, '0'),
    (v_calc_id, 'Tool Cost',          'Tool Cost (INR)',                        'number', 'INR',    NULL,  6, false, '0'),
    (v_calc_id, 'Tool Life',          'Tool Life (Parts)',                      'number', 'Parts',  NULL,  7, false, '0'),

    -- Process inputs (no "No of Uses" — time per part already per-part)
    (v_calc_id, 'Batch Time',         'Batch Inspection Time (s)',             'number', 's',      NULL,  8, false, NULL),
    (v_calc_id, 'Batch Size',         'Batch Size (Nos)',                      'number', 'Nos',    NULL,  9, false, NULL),

    -- Calculated
    (v_calc_id, 'Time per Part',      'Time per Part (s)',                     'calculated', 's',   NULL, 10, false, NULL),
    (v_calc_id, 'Tool Cost per Part', 'Tool Cost/Part (INR)',                  'calculated', 'INR', NULL, 11, false, NULL),
    (v_calc_id, 'Machine Cost',       'Machine Cost (INR)',                    'calculated', 'INR', NULL, 12, false, NULL),
    (v_calc_id, 'Labour Cost',        'Labour Cost (INR)',                     'calculated', 'INR', NULL, 13, false, NULL),
    (v_calc_id, 'Process Cost',       'Process Cost (INR)',                    'calculated', 'INR', NULL, 14, false, NULL),
    (v_calc_id, 'Setup Cost',         'Setup Cost (INR)',                      'calculated', 'INR', NULL, 15, false, NULL),
    (v_calc_id, 'Total Process Cost', 'Total Process Cost (INR)',              'calculated', 'INR', NULL, 16, false, NULL);

  UPDATE calculator_fields SET default_value = '{Batch Time} / {Batch Size}'
  WHERE calculator_id = v_calc_id AND field_name = 'Time per Part';

  UPDATE calculator_fields SET default_value = 'IF({Tool Life} > 0, {Tool Cost} / {Tool Life}, 0)'
  WHERE calculator_id = v_calc_id AND field_name = 'Tool Cost per Part';

  -- Machine Cost = MHR × Time per Part / 3600 (will be 0 when MHR = 0)
  UPDATE calculator_fields SET default_value = '{MHR per Hour} * {Time per Part} / 3600'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  UPDATE calculator_fields SET default_value = '{LHR per Hour} * {Time per Part} / (3600 * ({OLE} / 100))'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  UPDATE calculator_fields SET default_value = '{Machine Cost} + {Labour Cost} + {Tool Cost per Part}'
  WHERE calculator_id = v_calc_id AND field_name = 'Process Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} * ({Setup Percentage} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  UPDATE calculator_fields SET default_value = '{Process Cost} + {Setup Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Process Cost';

  RAISE NOTICE 'Done — Machining Inspection, ID: %', v_calc_id;
END $$;

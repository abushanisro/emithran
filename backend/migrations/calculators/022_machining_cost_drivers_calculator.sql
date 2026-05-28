-- ============================================================================
-- Calculator: Machining - Cost Drivers
-- Category:   Process
-- Fields:     11 (6 Number inputs from linked calculators, 5 Calculated)
-- Key formulas:
--   Machine Cost (INR) = (MHR per Hour / 3600) * Time per Part
--   Labour Cost (INR)  = (LHR per Hour / 3600) * Time per Part / (OLE / 100)
--   Process Cost       = Machine Cost + Labour Cost + Tool Cost per Part
--   Setup Cost         = Process Cost * (Setup Percentage / 100)
--   Total Process Cost = Process Cost + Setup Cost
-- Note: OLE applies to Labour only (Overall Labour Efficiency loss).
--       Machine Cost uses raw MHR rate without OLE adjustment.
-- Verified against example:
--   MHR=91.6, LHR=96.14, OLE=80%, Setup=30%, Time/Part=0.2s, Tool=0
--   → Machine=0.0051, Labour=0.0067, Process=0.0118, Setup=0.0035, Total=0.0153
-- Run in:     Supabase SQL Editor
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
    'Machining - Cost Drivers',
    'process',
    'single',
    false,
    false,
    'Machining cost drivers – machine cost, labour cost, tool cost, setup cost, total process cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Inputs from Manufacturing calculator
    (v_calc_id, 'MHR per Hour',        'MHR/hour (INR)',                     'number',     'INR/hr',  NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',        'LHR/hour (INR)',                     'number',     'INR/hr',  NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                 'OLE (%)',                            'number',     '%',       NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',    'Setup Percentage (%)',               'number',     '%',       NULL,  4, false, '30'),
    (v_calc_id, 'Tool Cost per Part',  'Tool Cost/Part (INR)',               'number',     'INR',     NULL,  5, false, '0'),
    (v_calc_id, 'Time per Part',       'Time/Part (s)',                      'number',     's',       NULL,  6, false, NULL),

    -- Calculated cost fields
    (v_calc_id, 'Machine Cost',        'Machine Cost (INR)',                 'calculated', 'INR',     NULL,  7, false, NULL),
    (v_calc_id, 'Labour Cost',         'Labour Cost (INR)',                  'calculated', 'INR',     NULL,  8, false, NULL),
    (v_calc_id, 'Process Cost',        'Process Cost (INR)',                 'calculated', 'INR',     NULL,  9, false, NULL),
    (v_calc_id, 'Setup Cost',          'Setup Cost (INR)',                   'calculated', 'INR',     NULL, 10, false, NULL),
    (v_calc_id, 'Total Process Cost',  'Total Process Cost (INR)',           'calculated', 'INR',     NULL, 11, false, NULL);

  -- Formula expressions
  -- Machine Cost: MHR per Hour is INR/hr, Time per Part is in seconds → divide by 3600
  UPDATE calculator_fields SET default_value =
    '({MHR per Hour} / 3600) * {Time per Part}'
  WHERE calculator_id = v_calc_id AND field_name = 'Machine Cost';

  -- Labour Cost: OLE divides (80% OLE → multiply effective time by 1/0.8)
  UPDATE calculator_fields SET default_value =
    '({LHR per Hour} / 3600) * {Time per Part} / ({OLE} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Labour Cost';

  -- Process Cost includes tooling
  UPDATE calculator_fields SET default_value =
    '{Machine Cost} + {Labour Cost} + {Tool Cost per Part}'
  WHERE calculator_id = v_calc_id AND field_name = 'Process Cost';

  UPDATE calculator_fields SET default_value =
    '{Process Cost} * ({Setup Percentage} / 100)'
  WHERE calculator_id = v_calc_id AND field_name = 'Setup Cost';

  UPDATE calculator_fields SET default_value =
    '{Process Cost} + {Setup Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Process Cost';

  RAISE NOTICE 'Done — Machining Cost Drivers, ID: %', v_calc_id;
END $$;

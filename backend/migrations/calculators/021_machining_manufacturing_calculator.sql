-- ============================================================================
-- Calculator: Machining - Manufacturing (W/C & M/C Details)
-- Category:   Process
-- Fields:     16 (5 Text/Select, 6 Number input, 2 Calculated, 3 Number)
-- Sections:   W/C Details + M/C Details
-- Key formulas:
--   Tool Cost per Part = IF(Tool Life > 0, Tool Cost / Tool Life, 0)
--   Time per Part (s)  = (Time per Batch / Part Volume) * No of Uses
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
    'Machining - Manufacturing',
    'process',
    'single',
    false,
    false,
    'Machining work center and machine details – rates, tooling, OLE, setup %, batch time, time per part'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- W/C Details – city / rates
    (v_calc_id, 'MHR City',            'MHR City',                           'text',       NULL,      NULL,  1, false, 'India'),
    (v_calc_id, 'LHR City',            'LHR City',                           'text',       NULL,      NULL,  2, false, 'India'),
    (v_calc_id, 'MHR per Hour',        'MHR/hour (INR)',                     'number',     'INR/hr',  NULL,  3, false, '91.6'),
    (v_calc_id, 'LHR per Hour',        'LHR/hour (INR)',                     'number',     'INR/hr',  NULL,  4, false, '96.14'),

    -- Tooling
    (v_calc_id, 'Tool Code',           'Tool Code',                          'text',       NULL,      NULL,  5, false, '0'),
    (v_calc_id, 'Tool Cost',           'Tool Cost (INR)',                    'number',     'INR',     NULL,  6, false, '0'),
    (v_calc_id, 'Tool Life',           'Tool Life (Parts)',                  'number',     'Parts',   NULL,  7, false, '0'),
    (v_calc_id, 'Tool Cost per Part',  'Tool Cost/Part (INR)',               'calculated', 'INR',     NULL,  8, false, NULL),

    -- W/C Parameters
    (v_calc_id, 'Setup Percentage',    'Setup Percentage (%)',               'number',     '%',       NULL,  9, false, '30'),
    (v_calc_id, 'OLE',                 'OLE (%)',                            'number',     '%',       NULL, 10, false, '80'),
    (v_calc_id, 'Part Volume',         'Part Volume (Nos)',                  'number',     'Nos',     NULL, 11, false, '300'),

    -- M/C Details
    (v_calc_id, 'Machine Name',        'Machine Name',                       'text',       NULL,      NULL, 12, false, NULL),
    (v_calc_id, 'Machine Type',        'Machine Type',                       'select',     NULL,      NULL, 13, false, 'CNC Lathe'),

    -- Batch / cycle time
    (v_calc_id, 'No of Uses',          'No. of Uses',                        'number',     NULL,      NULL, 14, false, '1'),
    (v_calc_id, 'Time per Batch',      'Time/Batch (s)',                     'number',     's',       NULL, 15, false, '60'),
    (v_calc_id, 'Time per Part',       'Time/Part (s)',                      'calculated', 's',       NULL, 16, false, NULL);

  -- Formula expressions
  -- Handle divide-by-zero when Tool Life = 0
  UPDATE calculator_fields SET default_value =
    'IF({Tool Life} > 0, {Tool Cost} / {Tool Life}, 0)'
  WHERE calculator_id = v_calc_id AND field_name = 'Tool Cost per Part';

  -- Time/Part (sec) = (Time/Batch / Part Volume) * No of Uses
  UPDATE calculator_fields SET default_value =
    '({Time per Batch} / {Part Volume}) * {No of Uses}'
  WHERE calculator_id = v_calc_id AND field_name = 'Time per Part';

  RAISE NOTICE 'Done — Machining Manufacturing, ID: %', v_calc_id;
END $$;

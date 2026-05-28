-- ============================================================================
-- Calculator: Machining - Rod/Tube Material Cost
-- Category:   Material
-- Shape:      Round Rod / Round Tube (set RM Part ID = 0 for solid rod)
-- Fields:     24 (3 Text/Select, 1 DB Lookup, 2 Number/DB, 8 Number input, 10 Calculated)
-- Key formulas (Density in g/cc → convert /1,000,000 for kg/mm³):
--   Part Volume (mm³)  = 0.7854 × (OD² − ID²) × (Part Length + Cut off allowance)
--   Parts Possible     = (RM Length − Min Leftover) / (Part Length + Cut off)
--   No of Parts        = FLOOR(Parts Possible)
--   RM Rod Weight (Kg) = 0.7854 × (OD² − ID²) × RM Length × Density / 1,000,000
--   Gross Weight (Kg)  = Part Volume × Density / 1,000,000
--   Scrap Weight (Kg)  = Gross Weight − Part Weight
--   Part RM Cost (INR) = (RM Rod Weight × RM Cost per Kg) / No of Parts
--   Part Scrap Cost    = Scrap Weight × (Scrap Recovery / 100) × Scrap Cost per Kg
--   Material Cost      = Part RM Cost − Part Scrap Cost
-- Verified against example (OD=30, ID=20, L=3000, Part L=15.25, Cut=2):
--   Part RM Cost = 4.430, Material Cost = 4.422
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
    'Machining - Rod/Tube Material Cost',
    'material',
    'single',
    false,
    false,
    'Round rod/tube material cost – parts per rod, gross/scrap weight, RM cost per part. Set ID=0 for solid rod.'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- RM Stock Details
    (v_calc_id, 'Shape',              'Shape',                          'select',         NULL,       NULL,            1, false, 'Round Tube'),
    (v_calc_id, 'Material Category',  'Material Category',              'text',           NULL,       NULL,            2, false, 'Aluminium'),
    (v_calc_id, 'Material Grade',     'Material Grade',                 'text',           NULL,       NULL,            3, false, 'AL 6061'),
    (v_calc_id, 'Density',            'Density (g/cc)',                 'database_lookup','g/cc',     'raw_materials',  4, false, '2.71'),
    (v_calc_id, 'Length of RM Rod',   'Length of RM Rod/Pipe (mm)',    'number',         'mm',       NULL,            5, false, '3000'),
    (v_calc_id, 'RM Part OD',         'RM Part OD (mm)',                'number',         'mm',       NULL,            6, false, '30'),
    (v_calc_id, 'RM Part ID',         'RM Part ID (mm) — 0 for solid', 'number',         'mm',       NULL,            7, false, '0'),

    -- Part Details
    (v_calc_id, 'Part Weight',        'Part Weight (Kg)',               'number',         'Kg',       NULL,            8, false, NULL),
    (v_calc_id, 'Part Length',        'Part Length (mm)',               'number',         'mm',       NULL,            9, false, NULL),
    (v_calc_id, 'Cut off allowance',  'Cut off allowance (mm)',         'number',         'mm',       NULL,           10, false, '2'),
    (v_calc_id, 'Minimum Leftover',   'Minimum Leftover (mm)',          'number',         'mm',       NULL,           11, false, '5'),
    (v_calc_id, 'Yield',              'Yield (%)',                      'number',         '%',        NULL,           12, false, '99'),
    (v_calc_id, 'Scrap Recovery',     'Scrap Recovery (%)',             'number',         '%',        NULL,           13, false, '95'),

    -- RM Cost Details (rate inputs)
    (v_calc_id, 'RM Cost per Kg',     'RM Cost/Kg (INR)',               'number',         'INR/Kg',   NULL,           14, false, NULL),
    (v_calc_id, 'Scrap Cost per Kg',  'Scrap Cost/Kg (INR)',            'number',         'INR/Kg',   NULL,           15, false, NULL),

    -- Calculated — Part geometry
    (v_calc_id, 'Part Volume',        'Part Volume (mm³)',              'calculated',     'mm³',      NULL,           16, false, NULL),
    (v_calc_id, 'Parts Possible',     'Parts Possible from RM stock',  'calculated',     'Nos',      NULL,           17, false, NULL),
    (v_calc_id, 'No of Parts',        'No of Parts (Nos)',              'calculated',     'Nos',      NULL,           18, false, NULL),

    -- Calculated — Weights
    (v_calc_id, 'RM Rod Weight',      'RM Rod/Pipe Weight (Kg)',        'calculated',     'Kg',       NULL,           19, false, NULL),
    (v_calc_id, 'Gross Weight',       'Gross Weight (Kg)',              'calculated',     'Kg',       NULL,           20, false, NULL),
    (v_calc_id, 'Scrap Weight',       'Scrap Weight (Kg)',              'calculated',     'Kg',       NULL,           21, false, NULL),

    -- Calculated — Costs
    (v_calc_id, 'Part RM Cost',       'Part RM Cost (INR)',             'calculated',     'INR',      NULL,           22, false, NULL),
    (v_calc_id, 'Part Scrap Cost',    'Part Scrap Cost (INR)',          'calculated',     'INR',      NULL,           23, false, NULL),
    (v_calc_id, 'Material Cost',      'Material Cost (INR)',            'calculated',     'INR',      NULL,           24, false, NULL);

  -- Formula expressions

  -- Blank volume = cross-section area × blank length (Part Length + cut-off)
  -- 0.7854 = π/4; ID=0 for solid rod gives full circle area
  UPDATE calculator_fields SET default_value =
    '0.7854 * ({RM Part OD}^2 - {RM Part ID}^2) * ({Part Length} + {Cut off allowance})'
  WHERE calculator_id = v_calc_id AND field_name = 'Part Volume';

  -- How many blanks fit in one rod after reserving minimum leftover at the end
  UPDATE calculator_fields SET default_value =
    '({Length of RM Rod} - {Minimum Leftover}) / ({Part Length} + {Cut off allowance})'
  WHERE calculator_id = v_calc_id AND field_name = 'Parts Possible';

  -- Integer count of parts per rod
  UPDATE calculator_fields SET default_value =
    'FLOOR({Parts Possible})'
  WHERE calculator_id = v_calc_id AND field_name = 'No of Parts';

  -- Full rod weight in kg — Density g/cc ÷ 1,000,000 converts to kg/mm³
  UPDATE calculator_fields SET default_value =
    '0.7854 * ({RM Part OD}^2 - {RM Part ID}^2) * {Length of RM Rod} * {Density} / 1000000'
  WHERE calculator_id = v_calc_id AND field_name = 'RM Rod Weight';

  -- Gross weight = blank volume × density (in kg)
  UPDATE calculator_fields SET default_value =
    '{Part Volume} * {Density} / 1000000'
  WHERE calculator_id = v_calc_id AND field_name = 'Gross Weight';

  -- Scrap from machining = blank weight minus finished part weight
  UPDATE calculator_fields SET default_value =
    '{Gross Weight} - {Part Weight}'
  WHERE calculator_id = v_calc_id AND field_name = 'Scrap Weight';

  -- RM cost per part = total rod cost distributed across integer number of parts
  UPDATE calculator_fields SET default_value =
    '({RM Rod Weight} * {RM Cost per Kg}) / {No of Parts}'
  WHERE calculator_id = v_calc_id AND field_name = 'Part RM Cost';

  -- Scrap recovery credit per part
  UPDATE calculator_fields SET default_value =
    '{Scrap Weight} * ({Scrap Recovery} / 100) * {Scrap Cost per Kg}'
  WHERE calculator_id = v_calc_id AND field_name = 'Part Scrap Cost';

  -- Net material cost = RM cost minus scrap recovery
  UPDATE calculator_fields SET default_value =
    '{Part RM Cost} - {Part Scrap Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Material Cost';

  RAISE NOTICE 'Done — Machining Rod/Tube Material Cost, ID: %', v_calc_id;
END $$;

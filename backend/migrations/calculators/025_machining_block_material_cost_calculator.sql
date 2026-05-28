-- ============================================================================
-- Calculator: Machining - Block Material Cost
-- Category:   Material
-- Fields:     24 (Block stock – 3D allowance on all sides)
-- Formulas:
--   Part Weight  = Finished Part Volume × Density / 1,000,000
--   Block Volume = Block Length × Block Width × Block Height
--   RM Volume    = (Proj L + Allow) × (Proj W + Allow) × (Proj H + Allow)
--   Parts Possible = Block Volume / RM Volume
--   Yield (%)    = (Finished Part Volume / RM Volume) × 100
--   Gross Weight = (Part Weight / Yield) × 100
--   Scrap Weight = Gross Weight − Part Weight
--   Part RM Cost = Gross Weight × RM Cost per Kg
--   Part Scrap Cost = Scrap Weight × (Scrap Recovery/100) × Scrap Cost per Kg
--   Material Cost   = Part RM Cost − Part Scrap Cost
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
    'Machining - Block Material Cost',
    'material',
    'single',
    false,
    false,
    'Block/bar stock material cost – 3D machining allowance, blank volume, yield, gross/scrap weight, net material cost'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'Material Category',    'Material Category',                  'text',           NULL,      NULL,            1, false, 'Steel'),
    (v_calc_id, 'Material Grade',       'Material Grade',                     'text',           NULL,      NULL,            2, false, NULL),
    (v_calc_id, 'Density',              'Density (g/cc)',                     'database_lookup','g/cc',    'raw_materials',  3, false, '7.85'),
    (v_calc_id, 'RM Cost per Kg',       'RM Cost/Kg (INR)',                   'number',         'INR/Kg',  NULL,             4, false, NULL),
    (v_calc_id, 'Scrap Cost per Kg',    'Scrap Cost/Kg (INR)',               'number',         'INR/Kg',  NULL,             5, false, NULL),
    (v_calc_id, 'Scrap Recovery',       'Scrap Recovery (%)',                 'number',         '%',       NULL,             6, false, '95'),

    -- Block stock dimensions
    (v_calc_id, 'Block Length',         'Block Length (mm)',                  'number',         'mm',      NULL,             7, false, NULL),
    (v_calc_id, 'Block Width',          'Block Width (mm)',                   'number',         'mm',      NULL,             8, false, NULL),
    (v_calc_id, 'Block Height',         'Block Height (mm)',                  'number',         'mm',      NULL,             9, false, NULL),

    -- Finished part
    (v_calc_id, 'Finished Part Volume', 'Finished Part Volume (mm3)',         'number',         'mm3',     NULL,            10, false, NULL),
    (v_calc_id, 'Proj Length',          'Projected Part Length (mm)',         'number',         'mm',      NULL,            11, false, NULL),
    (v_calc_id, 'Proj Width',           'Projected Part Width (mm)',          'number',         'mm',      NULL,            12, false, NULL),
    (v_calc_id, 'Proj Height',          'Projected Part Height (mm)',         'number',         'mm',      NULL,            13, false, NULL),
    (v_calc_id, 'Allowance',            'Machining Allowance per side (mm)', 'number',         'mm',      NULL,            14, false, '2'),

    -- Calculated
    (v_calc_id, 'Part Weight',          'Part Weight (Kg)',                   'calculated',     'Kg',      NULL,            15, false, NULL),
    (v_calc_id, 'Block Volume',         'Block Volume (mm3)',                 'calculated',     'mm3',     NULL,            16, false, NULL),
    (v_calc_id, 'RM Volume',            'RM Blank Volume (mm3)',              'calculated',     'mm3',     NULL,            17, false, NULL),
    (v_calc_id, 'Parts Possible',       'Parts Possible from Block',          'calculated',     'Nos',     NULL,            18, false, NULL),
    (v_calc_id, 'Yield',                'Yield (%)',                          'calculated',     '%',       NULL,            19, false, NULL),
    (v_calc_id, 'Gross Weight',         'Gross Weight (Kg)',                  'calculated',     'Kg',      NULL,            20, false, NULL),
    (v_calc_id, 'Scrap Weight',         'Scrap Weight (Kg)',                  'calculated',     'Kg',      NULL,            21, false, NULL),
    (v_calc_id, 'Part RM Cost',         'Part RM Cost (INR)',                 'calculated',     'INR',     NULL,            22, false, NULL),
    (v_calc_id, 'Part Scrap Cost',      'Part Scrap Cost (INR)',              'calculated',     'INR',     NULL,            23, false, NULL),
    (v_calc_id, 'Material Cost',        'Material Cost (INR)',                'calculated',     'INR',     NULL,            24, false, NULL);

  UPDATE calculator_fields SET default_value = '{Finished Part Volume} * {Density} / 1000000'
  WHERE calculator_id = v_calc_id AND field_name = 'Part Weight';

  UPDATE calculator_fields SET default_value = '{Block Length} * {Block Width} * {Block Height}'
  WHERE calculator_id = v_calc_id AND field_name = 'Block Volume';

  UPDATE calculator_fields SET default_value = '({Proj Length} + {Allowance}) * ({Proj Width} + {Allowance}) * ({Proj Height} + {Allowance})'
  WHERE calculator_id = v_calc_id AND field_name = 'RM Volume';

  UPDATE calculator_fields SET default_value = '{Block Volume} / {RM Volume}'
  WHERE calculator_id = v_calc_id AND field_name = 'Parts Possible';

  UPDATE calculator_fields SET default_value = '({Finished Part Volume} / {RM Volume}) * 100'
  WHERE calculator_id = v_calc_id AND field_name = 'Yield';

  UPDATE calculator_fields SET default_value = '({Part Weight} / {Yield}) * 100'
  WHERE calculator_id = v_calc_id AND field_name = 'Gross Weight';

  UPDATE calculator_fields SET default_value = '{Gross Weight} - {Part Weight}'
  WHERE calculator_id = v_calc_id AND field_name = 'Scrap Weight';

  UPDATE calculator_fields SET default_value = '{Gross Weight} * {RM Cost per Kg}'
  WHERE calculator_id = v_calc_id AND field_name = 'Part RM Cost';

  UPDATE calculator_fields SET default_value = '{Scrap Weight} * ({Scrap Recovery} / 100) * {Scrap Cost per Kg}'
  WHERE calculator_id = v_calc_id AND field_name = 'Part Scrap Cost';

  UPDATE calculator_fields SET default_value = '{Part RM Cost} - {Part Scrap Cost}'
  WHERE calculator_id = v_calc_id AND field_name = 'Material Cost';

  RAISE NOTICE 'Done — Machining Block Material Cost, ID: %', v_calc_id;
END $$;

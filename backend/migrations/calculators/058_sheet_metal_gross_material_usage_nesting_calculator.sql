-- ============================================================================
-- Calculator: Sheet Metal - Gross Material Usage (Nesting)
-- Category:   Material (global -- user_id NULL, requires migration 470)
-- Fields:     7 real inputs, 1 resolved-geometry disclosure field, 12 calculated
--
-- physics_key='sheet_metal_gross_usage_nesting' (set by migration 468) drives
-- the real computed value -- BOMItemsService.resolveGrossUsageForCalculator,
-- which wraps the SAME resolveTrueShapeNestCosting evaluation the cost
-- summary always ran (real cad-engine true-shape nest, evaluated across
-- every STANDARD_SHEETS candidate, selected by lowest gross weight/part).
-- True-shape nesting (BLF bin-packing of a real polygon) is NOT expressible
-- as a mathjs formula string -- the default_value strings below are seeded
-- purely as human-readable "Why: {formula}" documentation (migration 056's
-- convention), never executed once physics_key is set.
--
-- Every input field below was verified against the actual call site
-- (bom-items.service.ts's resolveTrueShapeNestCosting /
-- resolveGrossUsageForCalculator) before being added -- Flat Pattern
-- Length/Width are deliberately EXCLUDED because they are NOT passed to
-- cad-engine's computeTrueNest at all (only outlinePointsMm/holesMm/
-- sheetWidthMm/sheetLengthMm/kerfMm/edgeMarginMm are); the real geometry
-- input is the resolved CAD flat-pattern outline itself, which is not a
-- scalar a calculator field can hold as an editable input -- it is
-- represented below as a real field (is_required, so it's part of the
-- calculator's declared contract) but the frontend renders it in a visually
-- distinct, non-editable "Resolved Geometry" group, never mixed with the
-- genuinely editable inputs.
--
-- Run in:     Supabase SQL Editor, AFTER migration 470.
-- ============================================================================

DO $$
DECLARE
  v_calc_id UUID;
BEGIN
  INSERT INTO calculators (
    user_id, name, calc_category, calculator_type, is_template, is_public, description
  ) VALUES (
    NULL,
    'Sheet Metal - Gross Material Usage (Nesting)',
    'material',
    'single',
    false,
    true,
    'Calculates per-part gross material usage from a real flat-pattern true-shape nest, evaluated across every viable standard sheet size.'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Real editable inputs -- each genuinely consumed by the real evaluation
    (v_calc_id, 'Material',              'Material',                          'text',           NULL,   NULL,             1, false, NULL),
    (v_calc_id, 'Thickness',              'Thickness (mm)',                    'number',         'mm',   NULL,             2, false, NULL),
    (v_calc_id, 'Net Weight Per Part',    'Net Weight Per Part (kg)',         'number',         'kg',   NULL,             3, false, NULL),
    (v_calc_id, 'Shear Strength',         'Shear Strength (MPa)',              'database_lookup','MPa',  'raw_materials',  4, false, NULL),
    (v_calc_id, 'Edge Allowance',         'Edge Allowance (mm)',                'number',         'mm',   NULL,             5, false, '2'),
    (v_calc_id, 'Material Density',       'Material Density (kg/m³)',         'database_lookup','kg/m³','raw_materials',  6, false, NULL),
    (v_calc_id, 'Batch Quantity',         'Batch Quantity (order qty)',        'number',         NULL,   NULL,             7, false, NULL),
    -- Resolved geometry -- required by the real evaluation, but NOT a
    -- calculator-form scalar; rendered read-only, never an editable input.
    (v_calc_id, 'Flat Pattern Outline',   'Flat Pattern Outline',              'text',           NULL,   NULL,             8, true,  'Resolved server-side from CAD wire-walk extraction — required for true-shape nesting, not user-enterable'),
    -- Calculated (documentation-only default_value -- physics_key drives the real value)
    (v_calc_id, 'Part To Part Allowance','Part-to-Part Allowance (mm)',        'calculated',     'mm',   NULL,             9, false, NULL),
    (v_calc_id, 'Nest Method',            'Nest Method',                       'calculated',     NULL,   NULL,            10, false, NULL),
    (v_calc_id, 'Selected Sheet Width',   'Selected Sheet Width (mm)',         'calculated',     'mm',   NULL,            11, false, NULL),
    (v_calc_id, 'Selected Sheet Length',  'Selected Sheet Length (mm)',        'calculated',     'mm',   NULL,            12, false, NULL),
    (v_calc_id, 'Parts Per Sheet',        'Parts Per Sheet',                   'calculated',     NULL,   NULL,            13, false, NULL),
    (v_calc_id, 'Sheet Weight',           'Sheet Weight (kg)',                 'calculated',     'kg',   NULL,            14, false, NULL),
    (v_calc_id, 'Gross Weight Per Part',  'Gross Weight Per Part (kg)',       'calculated',     'kg',   NULL,            15, false, NULL),
    (v_calc_id, 'Scrap Weight Per Part',  'Scrap Weight Per Part (kg)',       'calculated',     'kg',   NULL,            16, false, NULL),
    (v_calc_id, 'Utilisation',            'Material Utilisation (%)',         'calculated',     '%',    NULL,            17, false, NULL),
    (v_calc_id, 'Sheets Required',        'Sheets Required',                   'calculated',     NULL,   NULL,            18, false, NULL),
    (v_calc_id, 'Planned Parts',          'Planned Parts',                     'calculated',     NULL,   NULL,            19, false, NULL),
    (v_calc_id, 'Excess Positions',       'Excess Positions',                  'calculated',     NULL,   NULL,            20, false, NULL),
    (v_calc_id, 'Actual Batch Gross Material', 'Actual Batch Gross Material (kg)', 'calculated', 'kg',   NULL,            21, false, NULL);

  UPDATE calculator_fields SET default_value = '{Thickness} * sqrt({Shear Strength} / 10) * 0.01'
    WHERE calculator_id = v_calc_id AND field_name = 'Part To Part Allowance';
  UPDATE calculator_fields SET default_value = 'true_shape nest (real flat-pattern silhouette, cad-engine) if the resolved outline is verified; rectangle_grid_fallback otherwise -- see nestingFallbackReason'
    WHERE calculator_id = v_calc_id AND field_name = 'Nest Method';
  UPDATE calculator_fields SET default_value = 'evaluated across every viable standard sheet (STANDARD_SHEETS); the candidate with the lowest resulting Gross Weight Per Part wins'
    WHERE calculator_id = v_calc_id AND field_name IN ('Selected Sheet Width', 'Selected Sheet Length', 'Parts Per Sheet');
  UPDATE calculator_fields SET default_value = '{Selected Sheet Width} * {Selected Sheet Length} * {Thickness} * {Material Density} / 1000000000'
    WHERE calculator_id = v_calc_id AND field_name = 'Sheet Weight';
  UPDATE calculator_fields SET default_value = '{Sheet Weight} / {Parts Per Sheet}'
    WHERE calculator_id = v_calc_id AND field_name = 'Gross Weight Per Part';
  UPDATE calculator_fields SET default_value = '{Gross Weight Per Part} - {Net Weight Per Part}'
    WHERE calculator_id = v_calc_id AND field_name = 'Scrap Weight Per Part';
  UPDATE calculator_fields SET default_value = '({Net Weight Per Part} / {Gross Weight Per Part}) * 100'
    WHERE calculator_id = v_calc_id AND field_name = 'Utilisation';
  UPDATE calculator_fields SET default_value = 'CEIL({Batch Quantity} / {Parts Per Sheet})'
    WHERE calculator_id = v_calc_id AND field_name = 'Sheets Required';
  UPDATE calculator_fields SET default_value = '{Parts Per Sheet} * {Sheets Required}'
    WHERE calculator_id = v_calc_id AND field_name = 'Planned Parts';
  UPDATE calculator_fields SET default_value = '{Planned Parts} - {Batch Quantity}'
    WHERE calculator_id = v_calc_id AND field_name = 'Excess Positions';
  UPDATE calculator_fields SET default_value = '{Sheets Required} * {Sheet Weight}'
    WHERE calculator_id = v_calc_id AND field_name = 'Actual Batch Gross Material';

  RAISE NOTICE 'Done — Sheet Metal - Gross Material Usage (Nesting), ID: %', v_calc_id;
END $$;

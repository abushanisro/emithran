-- ============================================================================
-- Calculator: Sheet Metal - Net Material Usage
-- Category:   Material (global -- user_id NULL, requires migration 470)
-- Fields:     4 (1 Text, 1 DB Lookup, 1 Number, 2 Calculated)
--
-- physics_key='sheet_metal_net_usage' (set by migration 468) drives the real
-- computed value -- backend/src/modules/bom-items/costing/sheet-metal-net-
-- usage.physics.ts. The formula strings below are seeded purely as human-
-- readable "Why: {formula}" documentation (same convention migration 056
-- already established for tapping/deburring) -- never executed once
-- physics_key is set.
--
-- Verified against the real live formula (bom-items.service.ts's
-- smNetWeightKg): netUsageKg = (flatPatternAreaMm2 * thicknessMm / 1e9) *
-- densityKgM3. Both Flat Pattern Area and Thickness are genuinely consumed
-- scalars, matching migration 007's own already-vetted Area x Thickness =
-- Volume breakdown for the identical physical quantity.
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
    'Sheet Metal - Net Material Usage',
    'material',
    'single',
    false,
    true,
    'Calculates finished-part (net) material weight from CAD flat-pattern area, thickness, and material density.'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    -- Inputs
    (v_calc_id, 'Material',            'Material',                 'text',           NULL,   NULL,             1, false, NULL),
    (v_calc_id, 'Flat Pattern Area',   'Flat Pattern Area (mm²)',  'number',         'mm²',  NULL,             2, false, NULL),
    (v_calc_id, 'Thickness',           'Thickness (mm)',           'number',         'mm',   NULL,             3, false, NULL),
    (v_calc_id, 'Material Density',    'Material Density (kg/m³)', 'database_lookup','kg/m³','raw_materials',  4, false, NULL),
    -- Calculated (documentation-only default_value -- physics_key drives the real value)
    (v_calc_id, 'Volume',              'Volume (mm³)',             'calculated',     'mm³',  NULL,             5, false, NULL),
    (v_calc_id, 'Net Usage',           'Net Usage (kg)',            'calculated',     'kg',   NULL,             6, false, NULL);

  UPDATE calculator_fields SET default_value = '{Flat Pattern Area} * {Thickness}'
    WHERE calculator_id = v_calc_id AND field_name = 'Volume';
  UPDATE calculator_fields SET default_value = '({Volume} * {Material Density}) / 1000000000'
    WHERE calculator_id = v_calc_id AND field_name = 'Net Usage';

  RAISE NOTICE 'Done — Sheet Metal - Net Material Usage, ID: %', v_calc_id;
END $$;

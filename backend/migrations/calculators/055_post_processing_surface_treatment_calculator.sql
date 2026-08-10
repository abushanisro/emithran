-- ============================================================================
-- Calculator: Post Processing - Surface Treatment
-- Category:   Process
-- Closes task #115 (Manufacturing Physics Calculator architecture). Per the
-- architecture's own explicit rule for this process: Surface Treatment is
-- NOT a cycle-time model — there is no real per-part machine cycle for a
-- subcontracted-style area treatment (anodize/plating/powder-coat/etc.).
-- This calculator returns AREA/RATE/COST outputs only, mirroring the exact
-- arithmetic cost-surface-treatment.ts used to compute inline:
--   Area Cost              = (Surface Area / 1,000,000) * Rate Per M2
--   Min Lot Cost Per Part  = Min Lot Charge / Lot Size
--   Total Cost             = max(Area Cost, Min Lot Cost Per Part)
--
-- Rate Per M2 / Min Lot Charge are resolved by the caller
-- (BomItemsService.resolveSurfaceTreatmentDbRate, surface_treatment_rates
-- table, already converted to local currency) and fed in as plain inputs —
-- same convention as every other lookup-fed field in this registry (e.g.
-- "Sheet Metal - Bending Manufacturing"'s own 'Stroke Time Per Bend'). This
-- calculator does not — and cannot — query that table itself; formula
-- strings have no DB access.
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
    'Post Processing - Surface Treatment',
    'process',
    'single',
    false,
    false,
    'Surface Treatment (anodize / plating / powder coat / passivation / ...) - real area x rate vs. amortized min-lot cost, NOT a cycle-time model, wired into the registry/trace/gap pipeline'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'Surface Area',            'Surface Area (mm2)',             'number', 'mm2', NULL, 1, false, NULL),
    (v_calc_id, 'Rate Per M2',              'Rate per m2 (local currency)',   'number', NULL,  NULL, 2, false, NULL),
    (v_calc_id, 'Min Lot Charge',           'Min Lot Charge (local currency)','number', NULL,  NULL, 3, false, NULL),
    (v_calc_id, 'Lot Size',                 'Lot Size',                       'number', NULL,  NULL, 4, false, '1'),

    (v_calc_id, 'Area Cost',                'Area Cost',                     'calculated', NULL, NULL, 5, false, NULL),
    (v_calc_id, 'Min Lot Cost Per Part',    'Min Lot Cost Per Part',         'calculated', NULL, NULL, 6, false, NULL),
    (v_calc_id, 'Total Cost',               'Total Cost',                    'calculated', NULL, NULL, 7, false, NULL);

  UPDATE calculator_fields SET default_value = '({Surface Area} / 1000000) * {Rate Per M2}'
  WHERE calculator_id = v_calc_id AND field_name = 'Area Cost';

  UPDATE calculator_fields SET default_value = '{Min Lot Charge} / {Lot Size}'
  WHERE calculator_id = v_calc_id AND field_name = 'Min Lot Cost Per Part';

  UPDATE calculator_fields SET default_value = 'max({Area Cost}, {Min Lot Cost Per Part})'
  WHERE calculator_id = v_calc_id AND field_name = 'Total Cost';

  -- Link into process_calculator_mappings — migration 433's new row
  -- (machine_class='surface_treatment') has calculator_id NULL by
  -- construction (it never existed before that migration).
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'surface_treatment'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Post Processing Surface Treatment, ID: %', v_calc_id;
END $$;

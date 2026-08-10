-- ============================================================================
-- Calculator: Sheet Metal - Hole Extrusion (Burring)
-- Category:   Process
-- Wraps the REAL, already-existing forming-force physics and stroke-time
-- lookup (previously computed inline in bom-items.service.ts/cost-engine.ts)
-- so Hole Extrusion goes through the same registry/trace/gap pipeline as
-- every other migrated process — not new data, the same real formula.
--
-- Real, cited formula (default-rates.ts's estimateBurlTonnage — sourced from
-- memory/sheetmetal/Drawing_Forming_Calculator.md's "Stamping - Progressive"
-- sheet): Fd(Ton) = (Punch Perimeter x Thickness x UTS x (Fp/Dp - 0.7)) / 9810,
-- Punch Perimeter = 0.95 x pi x Diameter (standard round-die clearance),
-- Fp/Dp = 1/0.95 for a round hole flange.
--
-- Stroke Time is a real per-stroke lookup (sm_lookup_manual_stroke, EXACT_MATCH
-- policy — migration 427) resolved by the caller (bom-items.service.ts) from
-- the real required tonnage this same formula computes — fed in as a plain
-- input, same convention as "Sheet Metal - Bending Manufacturing"'s own
-- 'Stroke Time Per Bend' field. This calculator does not — and cannot —
-- query that table itself; formula strings have no DB access.
--
-- Formulas:
--   Punch Perimeter    = 0.95 * pi * Diameter
--   Theoretical Force  = (Punch Perimeter * Thickness * UTS * ((1/0.95) - 0.7)) / 9810
--   Total Time          = No Of Extrusions * Stroke Time
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
    'Sheet Metal - Hole Extrusion (Burring)',
    'process',
    'single',
    false,
    false,
    'Hole Extrusion (Burring) – real forming-force physics + sm_lookup_manual_stroke stroke-time lookup, wraps the existing real formula in the registry/trace pipeline'
  )
  RETURNING id INTO v_calc_id;

  INSERT INTO calculator_fields
    (calculator_id, field_name, display_label, field_type, unit, data_source, display_order, is_required, default_value)
  VALUES
    (v_calc_id, 'MHR per Hour',       'MHR/hour (INR/hr)',       'number', 'INR/hr', NULL,  1, false, '91.6'),
    (v_calc_id, 'LHR per Hour',       'LHR/hour (INR/hr)',       'number', 'INR/hr', NULL,  2, false, '96.14'),
    (v_calc_id, 'OLE',                'OLE (%)',                 'number', '%',      NULL,  3, false, '80'),
    (v_calc_id, 'Setup Percentage',   'Setup Percentage (%)',    'number', '%',      NULL,  4, false, '30'),

    (v_calc_id, 'Diameter',            'Burl Diameter (mm)',       'number', 'mm',   NULL,  5, false, NULL),
    (v_calc_id, 'Thickness',           'Sheet Thickness (mm)',     'number', 'mm',   NULL,  6, false, NULL),
    (v_calc_id, 'UTS',                 'Material UTS (MPa)',       'number', 'MPa',  NULL,  7, false, NULL),
    (v_calc_id, 'Stroke Time',         'Stroke Time (s)',          'number', 's',    NULL,  8, false, NULL),
    (v_calc_id, 'No Of Extrusions',    'No. of Extrusions',        'number', NULL,   NULL,  9, false, '1'),

    (v_calc_id, 'Punch Perimeter',     'Punch Perimeter (mm)',    'calculated', 'mm',  NULL, 10, false, NULL),
    (v_calc_id, 'Theoretical Force',   'Theoretical Force (Ton)', 'calculated', 'Ton', NULL, 11, false, NULL),
    (v_calc_id, 'Total Time',          'Total Time (s)',          'calculated', 's',   NULL, 12, false, NULL),
    (v_calc_id, 'Machine Cost',        'Machine Cost (INR)',      'calculated', 'INR', NULL, 13, false, NULL),
    (v_calc_id, 'Labour Cost',         'Labour Cost (INR)',       'calculated', 'INR', NULL, 14, false, NULL),
    (v_calc_id, 'Process Cost',        'Process Cost (INR)',      'calculated', 'INR', NULL, 15, false, NULL),
    (v_calc_id, 'Setup Cost',          'Setup Cost (INR)',        'calculated', 'INR', NULL, 16, false, NULL),
    (v_calc_id, 'Total Process Cost',  'Total Process Cost (INR)','calculated', 'INR', NULL, 17, false, NULL);

  UPDATE calculator_fields SET default_value = '0.95 * 3.14159265 * {Diameter}'
  WHERE calculator_id = v_calc_id AND field_name = 'Punch Perimeter';

  UPDATE calculator_fields SET default_value = '({Punch Perimeter} * {Thickness} * {UTS} * ((1 / 0.95) - 0.7)) / 9810'
  WHERE calculator_id = v_calc_id AND field_name = 'Theoretical Force';

  UPDATE calculator_fields SET default_value = '{No Of Extrusions} * {Stroke Time}'
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
  -- 'hole_forming', process_route='Hole Extrusion (Burring)' (migration 404)
  -- has calculator_id NULL by design today ("formula-driven, no interactive
  -- calculator" — no longer true now that a real calculator wraps that same
  -- formula).
  UPDATE process_calculator_mappings
  SET calculator_id = v_calc_id
  WHERE machine_class = 'hole_forming'
    AND calculator_id IS NULL;

  RAISE NOTICE 'Done — Sheet Metal Hole Extrusion (Burring), ID: %', v_calc_id;
END $$;

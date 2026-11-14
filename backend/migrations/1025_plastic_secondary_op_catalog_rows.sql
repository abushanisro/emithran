-- ============================================================================
-- Migration 1025: catalog rows for the plastic material drying, visual inspection and weight check
-- ============================================================================
-- Migrations 1023 and 1024 made the injection engine cost three secondary operations on their own machine classes:
--
--   Material Drying     material_drying     the machine-mounted desiccant dryer   "Injection Molding - Material Drying"
--   Visual Inspection   visual_inspection   the operator at the press             "Injection Molding - Visual Inspection"
--   Weight Check        weight_check        the operator on a bench scale          "Injection Molding - Weight Check"
--
-- Applying a route places each saved line under the process group of its machine (HR Rates) or, for a line with no machine, of its machine
-- class's process_calculator_mappings row. These classes had neither, so Apply refused the whole route:
--   "Material Drying" (material_drying) has no process group: its machine has none in HR Rates and the class has no
--   process_calculator_mappings row.
-- This adds, under Plastic Molding, one process_taxonomy row and one process_calculator_mappings row per class, bound to its calculator by
-- name (the calculators of 1023 and 1024 get a new id in each database).
--
-- This writes reference rows after REFERENCE_DATA.json's cut-off, so it is listed there under `exceptions`.
-- Idempotent: an existing row (same group + name / group + route + operation) is left as it is, and the check at the end fails the
-- migration if a class does not resolve its calculator.
-- ============================================================================

DO $st1025$
DECLARE
  missing text;
  unresolved text;
BEGIN
  -- A database without the reference catalog (a schema-only installation) has nothing to place these in: its catalog arrives whole in the
  -- reference-data package.
  IF NOT EXISTS (SELECT 1 FROM process_calculator_mappings) THEN
    RAISE NOTICE 'Migration 1025: no process catalog in this database (schema-only installation); nothing to add';
    RETURN;
  END IF;

  -- The calculators the rows bind to (migrations 1023, 1024). Never created here.
  SELECT string_agg(c.name, ', ') INTO missing
  FROM (VALUES ('Injection Molding - Material Drying'), ('Injection Molding - Visual Inspection'), ('Injection Molding - Weight Check')) AS c(name)
  WHERE NOT EXISTS (SELECT 1 FROM calculators k WHERE k.name = c.name AND k.user_id IS NULL AND k.retired_at IS NULL);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 1025 aborted: calculator(s) % not found (run 1023 and 1024 first)', missing;
  END IF;

  INSERT INTO process_taxonomy (id, process_group, process_name, machine_class, roadmap_status, is_active, display_order)
  VALUES
    ('a39559b0-861b-4f9e-9f3c-f2cec65ac4eb', 'Plastic Molding', 'Material Drying',   'material_drying',   'production', true, 7),
    ('c7b4b840-ea68-46ce-9aaa-cf30159e9027', 'Plastic Molding', 'Visual Inspection', 'visual_inspection', 'production', true, 8),
    ('415d4ab5-136f-499e-a994-aa13c7202e1f', 'Plastic Molding', 'Weight Check',      'weight_check',      'production', true, 9)
  ON CONFLICT (process_group, process_name) DO NOTHING;

  INSERT INTO process_calculator_mappings (
    id, process_group, process_route, operation, machine_class, calculator_id, calculator_name,
    applicable_families, lhr_process_group, is_active, display_order, canonical_process_id
  )
  SELECT v.id, 'Plastic Molding', v.operation, v.operation, v.machine_class, k.id, k.name,
         ARRAY['plastic_molded'], NULL, true, v.display_order, pt.id
  FROM (VALUES
    ('58f8e841-17ce-4fb0-8bb7-92679221cd52'::uuid, 'Material Drying',   'material_drying',   'Injection Molding - Material Drying',   7),
    ('6059dd29-44d6-42ff-a311-e55a5b02faad'::uuid, 'Visual Inspection', 'visual_inspection', 'Injection Molding - Visual Inspection', 8),
    ('288b9874-49a5-4f4d-8ffc-e806d38412a7'::uuid, 'Weight Check',      'weight_check',      'Injection Molding - Weight Check',      9)
  ) AS v(id, operation, machine_class, calculator, display_order)
  JOIN calculators k ON k.name = v.calculator AND k.user_id IS NULL AND k.retired_at IS NULL
  JOIN process_taxonomy pt ON pt.process_group = 'Plastic Molding' AND pt.process_name = v.operation
  ON CONFLICT (process_group, process_route, operation) DO NOTHING;

  -- Each class Apply places resolves a process group and its active calculator.
  SELECT string_agg(w.machine_class, ', ') INTO unresolved
  FROM (VALUES ('material_drying'), ('visual_inspection'), ('weight_check')) AS w(machine_class)
  WHERE NOT EXISTS (
    SELECT 1 FROM process_calculator_mappings m
    WHERE m.machine_class = w.machine_class AND m.process_group = 'Plastic Molding' AND m.is_active AND m.calculator_id IS NOT NULL
  );
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 1025 failed: % still have no Plastic Molding catalog row', unresolved;
  END IF;
  RAISE NOTICE 'Migration 1025 OK: material drying, visual inspection and weight check have their Plastic Molding catalog rows';
END
$st1025$;

NOTIFY pgrst, 'reload schema';

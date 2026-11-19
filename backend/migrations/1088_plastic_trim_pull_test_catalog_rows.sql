-- ============================================================================
-- Migration 1088: catalog rows for the plastic gate trimming, deflashing and insert pull test
-- ============================================================================
-- The injection engine costs three more secondary operations, each by its stored calculator:
--
--   Gate Trimming     gate_trimming     the operator at the bench   "Injection Molding - Gate Trimming"     (migration 1083)
--   Deflashing        deflashing        the operator at the bench   "Injection Molding - Deflashing"        (migration 1010)
--   Insert Pull Test  insert_pull_test  the pull-test station       "Injection Molding - Insert Pull Test"  (migration 1084)
--
-- Gate trimming and deflashing were charged on the deburring bench's rate and class, so Apply saved them under that class's catalog row
-- ("Finishing / Deslag", a sheet-metal operation): a multi-shot part's applied route listed its gate trim as "Default Deslag". The insert
-- pull test's class had no row at all. As migration 1025 did for drying and inspection, this adds under Plastic Molding one
-- process_taxonomy row and one process_calculator_mappings row per class, bound to its calculator by name.
--
-- Listed in REFERENCE_DATA.json's exceptions. Idempotent; the check at the end fails the migration if a class does not resolve its calculator.
-- ============================================================================

DO $st1088$
DECLARE
  missing text;
  unresolved text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM process_calculator_mappings) THEN
    RAISE NOTICE 'Migration 1088: no process catalog in this database (schema-only installation); nothing to add';
    RETURN;
  END IF;

  SELECT string_agg(c.name, ', ') INTO missing
  FROM (VALUES ('Injection Molding - Gate Trimming'), ('Injection Molding - Deflashing'), ('Injection Molding - Insert Pull Test')) AS c(name)
  WHERE NOT EXISTS (SELECT 1 FROM calculators k WHERE k.name = c.name AND k.user_id IS NULL AND k.retired_at IS NULL);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 1088 aborted: calculator(s) % not found (run 1010, 1083 and 1084 first)', missing;
  END IF;

  INSERT INTO process_taxonomy (id, process_group, process_name, machine_class, roadmap_status, is_active, display_order)
  VALUES
    ('a2d509d3-b79a-4fab-a681-4097563c1fad', 'Plastic Molding', 'Gate Trimming',    'gate_trimming',    'production', true, 10),
    ('b6b71e60-276b-4060-938b-8e0252a8d2d4', 'Plastic Molding', 'Deflashing',       'deflashing',       'production', true, 11),
    ('57937600-ac25-4233-9885-1747b953a2df', 'Plastic Molding', 'Insert Pull Test', 'insert_pull_test', 'production', true, 12)
  ON CONFLICT (process_group, process_name) DO NOTHING;

  INSERT INTO process_calculator_mappings (
    id, process_group, process_route, operation, machine_class, calculator_id, calculator_name,
    applicable_families, lhr_process_group, is_active, display_order, canonical_process_id
  )
  SELECT v.id, 'Plastic Molding', v.operation, v.operation, v.machine_class, k.id, k.name,
         ARRAY['plastic_molded'], NULL, true, v.display_order, pt.id
  FROM (VALUES
    ('3c278c99-20f3-4e55-a1a5-193a5d3bf540'::uuid, 'Gate Trimming',    'gate_trimming',    'Injection Molding - Gate Trimming',    10),
    ('c654bbe2-85c0-4dce-83a0-b0dae435d949'::uuid, 'Deflashing',       'deflashing',       'Injection Molding - Deflashing',       11),
    ('a36dfc76-6411-4a3d-8c5e-13478fe31d1f'::uuid, 'Insert Pull Test', 'insert_pull_test', 'Injection Molding - Insert Pull Test', 12)
  ) AS v(id, operation, machine_class, calculator, display_order)
  JOIN calculators k ON k.name = v.calculator AND k.user_id IS NULL AND k.retired_at IS NULL
  JOIN process_taxonomy pt ON pt.process_group = 'Plastic Molding' AND pt.process_name = v.operation
  ON CONFLICT (process_group, process_route, operation) DO NOTHING;

  SELECT string_agg(w.machine_class, ', ') INTO unresolved
  FROM (VALUES ('gate_trimming'), ('deflashing'), ('insert_pull_test')) AS w(machine_class)
  WHERE NOT EXISTS (
    SELECT 1 FROM process_calculator_mappings m
    WHERE m.machine_class = w.machine_class AND m.process_group = 'Plastic Molding' AND m.is_active AND m.calculator_id IS NOT NULL
  );
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 1088 failed: % still have no Plastic Molding catalog row', unresolved;
  END IF;
  RAISE NOTICE 'Migration 1088 OK: gate trimming, deflashing and insert pull test have their Plastic Molding catalog rows';
END
$st1088$;

NOTIFY pgrst, 'reload schema';

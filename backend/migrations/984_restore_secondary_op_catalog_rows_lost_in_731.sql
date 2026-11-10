-- ============================================================================
-- Migration 984: restore the secondary-operation catalog rows migration 731 deleted
-- ============================================================================
-- Migration 702 restored the catalog rows of six secondary-operation machine
-- classes so each resolves its calculator. Migration 731 ("scope process taxonomy
-- to named sources") then deleted every Machining / Assembly / Post Processing
-- row whose machine class was not on its keep-list of CNC and inspection engines.
-- drill_press, pem_press and tapping were not on it, so five of 702's rows went,
-- with their process_taxonomy rows (731 kept its own copies in
-- process_calculator_mappings_backup_731 / process_taxonomy_backup_731):
--
--   Machining / Drilling / Counterboring           drill_press  "Sheet Metal - Counterboring"
--   Machining / Drilling / Countersinking          drill_press  "Sheet Metal - Countersinking"
--   Assembly / Hardware Insertion / PEM Insertion  pem_press    "Sheet Metal - PEM Insertion"
--   Machining / VMC / Tapping                      tapping      "Machining - Tapping"  (cnc_milled)
--   Machining / Turning Center / Tapping           tapping      "Machining - Tapping"  (cnc_turned, mill_turn)
--
-- Since then every counterbore and countersink on a sheet-metal part has been
-- "unresolved: No calculator registered for machine class 'drill_press'", every
-- PEM insert the same for pem_press, and a route holding one cannot be applied
-- ("No route is both feasible and fully costed"). Tapping on a milled or turned
-- part fell back to the sheet-metal tapping row, so it took that labour tier.
--
-- Each row is put back exactly as 702 / the 731 backup had it: same ids, group,
-- route, class, families, display order, and the same calculator (bound by id;
-- the four calculators were never deleted). Machining rows get no
-- machining_route_role (added later, by 780), so the CNC station discovery,
-- which selects by role, does not take them for stations.
--
-- This writes reference rows after REFERENCE_DATA.json's cut-off, so it is listed
-- there under `exceptions` with the reason and the condition for removing it.
-- Idempotent: an existing row (same group + name / group + route + operation) is
-- left as it is, and the check at the end fails the migration if any of the five
-- does not resolve a calculator.
-- ============================================================================

DO $st984$
DECLARE
  missing text;
  unresolved text;
BEGIN
  -- A database without the reference catalog (a new installation from the schema-only baseline) has nothing to repair:
  -- its catalog arrives whole in the reference-data package.
  IF NOT EXISTS (SELECT 1 FROM process_calculator_mappings) THEN
    RAISE NOTICE 'Migration 984: no process catalog in this database (schema-only installation); nothing to restore';
    RETURN;
  END IF;

  -- The calculators the rows bind to. Never created here: if one is gone, the catalog cannot be restored honestly.
  SELECT string_agg(c.id::text, ', ') INTO missing
  FROM (VALUES
    ('edccd27a-c91c-479d-a440-d00053249a3a'::uuid),  -- Sheet Metal - Counterboring
    ('0f7d6451-3937-472d-9a4c-3f8f3ebf59d8'::uuid),  -- Sheet Metal - Countersinking
    ('72f84130-a741-425f-8fa9-9b027541801c'::uuid),  -- Sheet Metal - PEM Insertion
    ('fe42139c-5675-4a82-94d5-7f2d440ae9bf'::uuid)   -- Machining - Tapping
  ) AS c(id)
  WHERE NOT EXISTS (SELECT 1 FROM calculators k WHERE k.id = c.id);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 984 aborted: calculator(s) % not found; the secondary-operation rows cannot be bound', missing;
  END IF;

  INSERT INTO process_taxonomy (id, process_group, process_name, machine_class, roadmap_status, is_active, display_order)
  VALUES
    ('e8b10b9b-d608-4b4e-9caa-669f04e73306', 'Machining', 'Counterboring',  'drill_press', 'production', true, 0),
    ('6b331505-d0b0-4ad4-b119-2aa7fda4a281', 'Machining', 'Countersinking', 'drill_press', 'production', true, 0),
    ('7f7c3146-49ac-493f-834a-d5d9bf0fd642', 'Assembly',  'PEM Insertion',  'pem_press',   'production', true, 0),
    ('b102a914-d518-4af8-aa65-6ddf51fbee5f', 'Machining', 'Tapping',        'tapping',     'production', true, 0)
  ON CONFLICT (process_group, process_name) DO NOTHING;

  INSERT INTO process_calculator_mappings (
    id, process_group, process_route, operation, machine_class, calculator_id,
    applicable_families, lhr_process_group, is_active, display_order, canonical_process_id
  )
  SELECT v.id, v.process_group, v.process_route, v.operation, v.machine_class, v.calculator_id,
         v.applicable_families, NULL, true, v.display_order, pt.id
  FROM (VALUES
    ('b6919580-97b6-4243-875e-9659d9e2d864'::uuid, 'Machining', 'Drilling',           'Counterboring',  'drill_press', 'edccd27a-c91c-479d-a440-d00053249a3a'::uuid, NULL::text[],                      50),
    ('21a36124-41fe-48de-8a10-a6cee69bb12f'::uuid, 'Machining', 'Drilling',           'Countersinking', 'drill_press', '0f7d6451-3937-472d-9a4c-3f8f3ebf59d8'::uuid, NULL::text[],                      51),
    ('9e9e4349-7f95-41fc-9ae2-5247e33373c2'::uuid, 'Assembly',  'Hardware Insertion', 'PEM Insertion',  'pem_press',   '72f84130-a741-425f-8fa9-9b027541801c'::uuid, NULL::text[],                      52),
    ('d576fa82-4323-4466-bb0e-e237c7e21d58'::uuid, 'Machining', 'VMC',                'Tapping',        'tapping',     'fe42139c-5675-4a82-94d5-7f2d440ae9bf'::uuid, ARRAY['cnc_milled'],               134),
    ('939d24cc-8348-4c54-8374-c585c3e76aba'::uuid, 'Machining', 'Turning Center',     'Tapping',        'tapping',     'fe42139c-5675-4a82-94d5-7f2d440ae9bf'::uuid, ARRAY['cnc_turned', 'mill_turn'],  135)
  ) AS v(id, process_group, process_route, operation, machine_class, calculator_id, applicable_families, display_order)
  JOIN process_taxonomy pt ON pt.process_group = v.process_group AND pt.process_name = v.operation
  ON CONFLICT (process_group, process_route, operation) DO NOTHING;

  -- Each operation the sheet-metal and machining engines ask for by (machine class, operation) resolves an active calculator,
  -- the same selection BOMItemsService.resolveManufacturingPhysics makes.
  SELECT string_agg(w.machine_class || '/' || w.operation, ', ') INTO unresolved
  FROM (VALUES ('drill_press', 'Counterboring'), ('drill_press', 'Countersinking'), ('pem_press', 'PEM Insertion'), ('tapping', 'Tapping')) AS w(machine_class, operation)
  WHERE NOT EXISTS (
    SELECT 1 FROM process_calculator_mappings m
    WHERE m.machine_class = w.machine_class AND m.operation = w.operation AND m.is_active AND m.calculator_id IS NOT NULL
  );
  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 984 failed: % still resolve no calculator', unresolved;
  END IF;
  RAISE NOTICE 'Migration 984 OK: counterboring, countersinking, PEM insertion and tapping (milled, turned) resolve their calculators';
END
$st984$;

NOTIFY pgrst, 'reload schema';

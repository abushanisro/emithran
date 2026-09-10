-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 702: Restore the secondary-operation process_calculator_mappings
-- rows the catalog re-import dropped (2026-09-04)
--
-- SYMPTOM (reported live, USA factory, sheet-metal part 830-001720-00):
--   Custom route apply failed: Cannot apply this route -- Inspection cycle
--   time is unavailable: No calculator registered for machine class cmm.
--   PEM Insertion and Inspection also both quoted at $0.00 with
--   "Result Unavailable", and the quote carried
--   "No QA inspector rate in DB for USA -- inspection labor excluded".
--
-- ROOT CAUSE (verified against the live DB through the running API, not
-- inferred): process_calculator_mappings currently holds 71 rows, and NONE of
-- them has machine_class = cmm or pem_press. The rows are not merely missing a
-- calculator_id -- the rows themselves do not exist. 45 of the 71 live rows
-- have machine_class NULL entirely (a freshly imported Machining block whose
-- classes were never assigned), which is the signature of a catalog re-import
-- that replaced the table contents.
--
-- Every prior migration that wired these classes was written as an UPDATE
-- against rows that no longer exist, so each one silently matched zero rows
-- and reported success:
--   368  UPDATE ... SET machine_class = cmm    WHERE operation = CMM Inspection
--   381  INSERT Assembly/Hardware Insertion/PEM Insertion (pem_press)
--   404  INSERT Sheet Metal/Forming/Hole Extrusion (Burring) (hole_forming)
--   424  UPDATE ... SET lhr_process_group = Quality WHERE machine_class = cmm
--   433  INSERT Post Processing/Surface Treatment (surface_treatment)
--   052  UPDATE ... SET calculator_id = <tapping> WHERE operation = Tapping
--   calculators/049  UPDATE ... WHERE machine_class = cmm
--   calculators/053  UPDATE ... WHERE machine_class = pem_press
--
-- The calculators themselves are all present and correct in the live DB
-- (verified by name) -- only the mapping rows that bind them to a machine
-- class are gone. resolvePhysicsQuantity() resolves a calculator ONLY via
-- process_calculator_mappings.machine_class, so with no row it returns an
-- unsupported_operation gap, the engine emits cycleTimeMin 0 with a
-- physicsGap, and writeProcessLinesAsRecords() correctly refuses to write the
-- whole route (process_cost_records.cycle_time is NOT NULL CHECK >= 1).
-- The apply failure is that guard doing its job -- the defect is upstream.
--
-- The same missing row also breaks labour: resolveLHRRates() reads the billing
-- skill tier from process_calculator_mappings.lhr_process_group via
-- resolveProcessIdentities(), so with no cmm row there is no Quality tier to
-- resolve, which is the real source of the "No QA inspector rate" warning.
-- One missing row, four visible symptoms.
--
-- NOTHING HERE IS INVENTED. Every process_group / process_route / operation /
-- machine_class / lhr_process_group / applicable_families / display_order value
-- below is copied from the migration that originally established it (cited
-- inline per row). No cycle time, rate, or cost value is introduced by this
-- migration -- those come from the real calculators and the real MHR/LHR
-- resolution, exactly as they do for the classes that already work.
--
-- canonical_process_id is NOT NULL with an FK to process_taxonomy (migration
-- 610), so each row resolves its own id through the same join 610 itself uses
-- (process_group + operation). All seven target rows already exist in
-- process_taxonomy from the 609 seed -- verified -- so nothing new is seeded
-- there either.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Restore the missing mapping rows ──────────────────────────────────────
-- Sourced per row:
--   cmm                Post Processing / Inspection / CMM Inspection   -- 024 line 197, class from 368, lhr tier from 424
--   pem_press          Assembly / Hardware Insertion / PEM Insertion   -- 381
--   hole_forming       Sheet Metal / Forming / Hole Extrusion (Burring)-- 404
--   surface_treatment  Post Processing / Surface Treatment / ...       -- 433
--   tapping x3         per-family rows                                 -- 024 line 109, 368, 392 (applicable_families + Sheet Metal group)
--   drill_press x2     Machining / Drilling / Counterboring|Countersinking -- 381
--
-- lhr_process_group is NULL wherever migration 424 says NULL means "the
-- hierarchy domain already IS the correct labour tier" -- 424 names
-- hole_forming and tapping explicitly, and sets only cmm among these classes.
INSERT INTO process_calculator_mappings (
  process_group, process_route, operation, machine_class,
  lhr_process_group, applicable_families, is_active, display_order,
  canonical_process_id
)
SELECT
  v.process_group, v.process_route, v.operation, v.machine_class,
  v.lhr_process_group, v.applicable_families, true, v.display_order,
  pt.id
FROM (
  VALUES
    ('Post Processing', 'Inspection',        'CMM Inspection',             'cmm',               'Quality'::varchar, NULL::text[],                              422),
    ('Assembly',        'Hardware Insertion','PEM Insertion',              'pem_press',         NULL::varchar,      NULL::text[],                              52),
    ('Sheet Metal',     'Forming',           'Hole Extrusion (Burring)',   'hole_forming',      NULL::varchar,      NULL::text[],                              53),
    ('Post Processing', 'Surface Treatment', 'Surface Treatment',          'surface_treatment', NULL::varchar,      NULL::text[],                              434),
    ('Sheet Metal',     'Drilling',          'Tapping',                    'tapping',           NULL::varchar,      ARRAY['sheet_metal']::text[],              133),
    ('Machining',       'VMC',               'Tapping',                    'tapping',           NULL::varchar,      ARRAY['cnc_milled']::text[],               134),
    ('Machining',       'Turning Center',    'Tapping',                    'tapping',           NULL::varchar,      ARRAY['cnc_turned','mill_turn']::text[],   135),
    ('Machining',       'Drilling',          'Counterboring',              'drill_press',       NULL::varchar,      NULL::text[],                              50),
    ('Machining',       'Drilling',          'Countersinking',             'drill_press',       NULL::varchar,      NULL::text[],                              51)
) AS v(process_group, process_route, operation, machine_class, lhr_process_group, applicable_families, display_order)
JOIN process_taxonomy pt
  ON pt.process_group = v.process_group
 AND pt.process_name  = v.operation
ON CONFLICT (process_group, process_route, operation) DO NOTHING;

-- Re-assert the class/tier/family columns on any row that already existed but
-- had them stripped by the re-import. ON CONFLICT DO NOTHING above leaves such
-- a row untouched, so without this the row stays unresolvable.
UPDATE process_calculator_mappings pcm
SET machine_class      = v.machine_class,
    lhr_process_group  = COALESCE(v.lhr_process_group, pcm.lhr_process_group),
    applicable_families= COALESCE(v.applicable_families, pcm.applicable_families),
    is_active          = true
FROM (
  VALUES
    ('Post Processing', 'Inspection',        'CMM Inspection',           'cmm',               'Quality'::varchar, NULL::text[]),
    ('Assembly',        'Hardware Insertion','PEM Insertion',            'pem_press',         NULL::varchar,      NULL::text[]),
    ('Sheet Metal',     'Forming',           'Hole Extrusion (Burring)', 'hole_forming',      NULL::varchar,      NULL::text[]),
    ('Post Processing', 'Surface Treatment', 'Surface Treatment',        'surface_treatment', NULL::varchar,      NULL::text[]),
    ('Sheet Metal',     'Drilling',          'Tapping',                  'tapping',           NULL::varchar,      ARRAY['sheet_metal']::text[]),
    ('Machining',       'VMC',               'Tapping',                  'tapping',           NULL::varchar,      ARRAY['cnc_milled']::text[]),
    ('Machining',       'Turning Center',    'Tapping',                  'tapping',           NULL::varchar,      ARRAY['cnc_turned','mill_turn']::text[]),
    ('Machining',       'Drilling',          'Counterboring',            'drill_press',       NULL::varchar,      NULL::text[]),
    ('Machining',       'Drilling',          'Countersinking',           'drill_press',       NULL::varchar,      NULL::text[])
) AS v(process_group, process_route, operation, machine_class, lhr_process_group, applicable_families)
WHERE pcm.process_group = v.process_group
  AND pcm.process_route = v.process_route
  AND pcm.operation     = v.operation
  AND pcm.machine_class IS DISTINCT FROM v.machine_class;

-- ── 2. Bind each restored row to the calculator that already exists ──────────
-- Resolved BY NAME, never by a literal UUID pasted into a migration (migration
-- 052 hardcoded fe42139c-... for tapping; that is the pattern being retired).
-- Where a name is currently duplicated in the calculators table (see step 4),
-- the oldest row wins so repeated runs always pick the same one.
WITH canonical AS (
  SELECT DISTINCT ON (name) name, id
  FROM calculators
  ORDER BY name, created_at ASC, id ASC
)
UPDATE process_calculator_mappings pcm
SET calculator_id = c.id
FROM (
  VALUES
    ('cmm',               'Sheet Metal - Inspection'),
    ('pem_press',         'Sheet Metal - PEM Insertion'),
    ('hole_forming',      'Sheet Metal - Hole Extrusion (Burring)'),
    ('surface_treatment', 'Post Processing - Surface Treatment'),
    ('tapping',           'Machining - Tapping')
) AS m(machine_class, calculator_name)
JOIN canonical c ON c.name = m.calculator_name
WHERE pcm.machine_class = m.machine_class
  AND pcm.calculator_id IS NULL;

-- Counterboring and Countersinking share machine_class drill_press but have
-- their own real calculators, so they bind per-operation. This is safe because
-- both call sites pass `operation` to resolvePhysicsQuantity (bom-items.service
-- .ts resolveSecondaryHoleCycleTime), so the resolver filters on
-- machine_class AND operation and cannot cross them.
WITH canonical AS (
  SELECT DISTINCT ON (name) name, id
  FROM calculators
  ORDER BY name, created_at ASC, id ASC
)
UPDATE process_calculator_mappings pcm
SET calculator_id = c.id
FROM (
  VALUES
    ('Counterboring',  'Sheet Metal - Counterboring'),
    ('Countersinking', 'Sheet Metal - Countersinking')
) AS m(operation, calculator_name)
JOIN canonical c ON c.name = m.calculator_name
WHERE pcm.machine_class = 'drill_press'
  AND pcm.operation = m.operation
  AND pcm.calculator_id IS NULL;

-- ── 3. Remove fabricated rate defaults from calculator_fields ────────────────
-- calculator-formula-evaluator.ts falls back to calculator_fields.default_value
-- for any non-calculated field the caller does not seed. The PEM Insertion
-- calculator carries MHR per Hour = 91.6 and LHR per Hour = 96.14 as baked-in
-- defaults -- Indian-rupee figures from the original authoring, sitting on a
-- calculator now being resolved for a USA factory. The cycle-time path
-- (targetFieldNames = Total Time) does not read them today, but the Machine
-- Cost / Labour Cost / Process Cost / Total Process Cost formulas do, and the
-- interactive Process Cost dialog prefills them. A rate is never a property of
-- a calculator -- it is resolved per location from mhr_records / lhr_records --
-- so these are cleared rather than re-pointed at some other constant.
-- NULL (not 0) so an unseeded rate produces no number at all instead of a
-- confident-looking zero cost.
UPDATE calculator_fields cf
SET default_value = NULL
FROM calculators c
WHERE cf.calculator_id = c.id
  AND c.name IN (
    'Sheet Metal - PEM Insertion',
    'Sheet Metal - Inspection',
    'Sheet Metal - Hole Extrusion (Burring)',
    'Sheet Metal - Counterboring',
    'Sheet Metal - Countersinking',
    'Post Processing - Surface Treatment',
    'Machining - Tapping'
  )
  AND cf.field_type <> 'calculated'
  AND cf.field_name IN ('MHR per Hour', 'LHR per Hour')
  AND cf.default_value IS NOT NULL;

COMMIT;

-- ── 4. Report duplicate calculators (NOT auto-deleted) ───────────────────────
-- Five calculator names exist twice in the live DB, from migrations that
-- INSERT unconditionally and were run more than once:
--   Post Processing - Surface Treatment, Sheet Metal - PEM Insertion,
--   Post Processing - Ultrasonic Cleaning, Sheet Metal - Waterjet Cutting
--   Manufacturing, Machining - End Milling and Sawing.
-- These are NOT deleted here on purpose. process_calculator_mappings
-- .calculator_id is ON DELETE CASCADE (migration 024), so deleting a duplicate
-- calculator silently deletes any mapping row pointing at it -- which is a
-- plausible mechanism for how the rows this migration restores were lost in
-- the first place. Step 2 above pins every binding to the oldest row per name,
-- so the duplicates are inert; cleaning them up is a separate, deliberate
-- change that should re-point first and delete second.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT name, count(*) AS n FROM calculators GROUP BY name HAVING count(*) > 1 ORDER BY name
  LOOP
    RAISE NOTICE 'Duplicate calculator (not deleted): % appears % times', r.name, r.n;
  END LOOP;
END $$;

-- ── 5. Verification: fail loudly if the reported defect is not actually fixed ─
DO $$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(cls, ', ' ORDER BY cls) INTO missing
  FROM unnest(ARRAY[
    'cmm', 'pem_press', 'hole_forming', 'surface_treatment', 'tapping', 'drill_press'
  ]) AS cls
  WHERE NOT EXISTS (
    SELECT 1 FROM process_calculator_mappings p
    WHERE p.machine_class = cls
      AND p.is_active = true
      AND p.calculator_id IS NOT NULL
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 702 did not fully apply: no active mapping row with a calculator_id for machine class(es): %. Inspect with: SELECT process_group, process_route, operation, machine_class, calculator_id FROM process_calculator_mappings WHERE machine_class IS NOT NULL ORDER BY machine_class;',
      missing;
  END IF;

  RAISE NOTICE 'Migration 702 OK -- cmm, pem_press, hole_forming, surface_treatment, tapping and drill_press all resolve an active calculator.';
END $$;

-- ── Verification queries (informational) ─────────────────────────────────────
-- Expect 9 restored rows, each with a calculator_id:
--   SELECT process_group, process_route, operation, machine_class,
--          lhr_process_group, applicable_families, calculator_id IS NOT NULL AS has_calc
--     FROM process_calculator_mappings
--    WHERE machine_class IN ('cmm','pem_press','hole_forming','surface_treatment','tapping','drill_press')
--    ORDER BY machine_class, display_order;
--
-- Expect zero rows (no fabricated rate defaults remain on these calculators):
--   SELECT c.name, cf.field_name, cf.default_value
--     FROM calculator_fields cf JOIN calculators c ON c.id = cf.calculator_id
--    WHERE cf.field_name IN ('MHR per Hour','LHR per Hour')
--      AND cf.default_value IS NOT NULL
--      AND c.name LIKE ANY (ARRAY['Sheet Metal - %','Post Processing - %','Machining - Tapping']);
--
-- Then re-run the failing action: open the part, Apply Scenario with the
-- Turret Punching + Press Brake + Deburring + Inspection route. Inspection and
-- PEM Insertion should now carry a real cycle time and cost instead of
-- "Result Unavailable", and apply-custom-route should return 200.

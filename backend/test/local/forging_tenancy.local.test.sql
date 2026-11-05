-- Tenant isolation of the rows the forging reference service reads with a user's own client:
-- mhr_records (forging machines) and raw_materials (Forging group).
--
-- Runs against the LOCAL Postgres only (npm run local:up, baseline loaded), because the real policies depend on
-- is_user_authorized(), current_user_org_ids() and the loaded baseline. Everything happens in one transaction that
-- is rolled back: no row is left behind. Never point this at a shared database.
--   npm run test:local-tenancy
BEGIN;

-- Two users in two different organisations, both authorised.
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a'), ('bbbbbbbb-0000-4000-8000-00000000000b');
UPDATE auth.users SET email = 'forging-a@example.test' WHERE id = 'aaaaaaaa-0000-4000-8000-00000000000a';
UPDATE auth.users SET email = 'forging-b@example.test' WHERE id = 'bbbbbbbb-0000-4000-8000-00000000000b';
INSERT INTO authorized_users (email, is_active) VALUES ('forging-a@example.test', true), ('forging-b@example.test', true);
INSERT INTO organizations (id, name, owner_id) VALUES
  ('aaaaaaaa-1111-4000-8000-00000000000a', 'Forging test org A', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-1111-4000-8000-00000000000b', 'Forging test org B', 'bbbbbbbb-0000-4000-8000-00000000000b');
INSERT INTO organization_members (organization_id, user_id, status) VALUES
  ('aaaaaaaa-1111-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-00000000000a', 'active'),
  ('bbbbbbbb-1111-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-00000000000b', 'active');

-- Org A's private forging machine and material (the service reads both with the caller's client).
INSERT INTO mhr_records (location, machine_name, machine_class, organization_id)
  VALUES ('USA', 'TENANCY-TEST org A press', 'forging_press', 'aaaaaaaa-1111-4000-8000-00000000000a');
INSERT INTO raw_materials (material_group, grade, name, organization_id, user_id)
  VALUES ('Forging', 'TENANCY-TEST-A', 'TENANCY-TEST org A steel', 'aaaaaaaa-1111-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-00000000000a');

CREATE TEMP TABLE seen (who text, machines_own int, machines_other int, machines_global int, materials_own int, materials_other int, materials_global int);
GRANT ALL ON seen TO authenticated;

CREATE FUNCTION pg_temp.probe(who text, uid text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO seen SELECT who,
    (SELECT count(*) FROM mhr_records WHERE machine_name = 'TENANCY-TEST org A press'),
    (SELECT count(*) FROM mhr_records WHERE machine_name = 'TENANCY-TEST org A press' AND who = 'B'),
    (SELECT count(*) FROM mhr_records WHERE machine_class LIKE 'forging%' AND organization_id IS NULL),
    (SELECT count(*) FROM raw_materials WHERE name = 'TENANCY-TEST org A steel'),
    (SELECT count(*) FROM raw_materials WHERE name = 'TENANCY-TEST org A steel' AND who = 'B'),
    (SELECT count(*) FROM raw_materials WHERE material_group = 'Forging' AND organization_id IS NULL);
  RESET ROLE;
END $f$;

SELECT pg_temp.probe('A', 'aaaaaaaa-0000-4000-8000-00000000000a');
SELECT pg_temp.probe('B', 'bbbbbbbb-0000-4000-8000-00000000000b');

DO $$
DECLARE a seen%ROWTYPE; b seen%ROWTYPE; g_machines int; g_materials int;
BEGIN
  SELECT * INTO a FROM seen WHERE who = 'A';
  SELECT * INTO b FROM seen WHERE who = 'B';
  SELECT count(*) INTO g_machines FROM mhr_records WHERE machine_class LIKE 'forging%' AND organization_id IS NULL;
  SELECT count(*) INTO g_materials FROM raw_materials WHERE material_group = 'Forging' AND organization_id IS NULL;
  ASSERT g_machines > 0 AND g_materials > 0, 'baseline has no global forging rows: load it first';
  ASSERT a.machines_own = 1 AND a.materials_own = 1, 'org A cannot see its own private forging rows';
  ASSERT b.machines_own = 0, 'org B can see org A''s private forging machine';
  ASSERT b.materials_own = 0, 'org B can see org A''s private forging material';
  ASSERT a.machines_global = g_machines AND b.machines_global = g_machines, 'global forging machines are not visible to both orgs';
  ASSERT a.materials_global = g_materials AND b.materials_global = g_materials, 'global forging materials are not visible to both orgs';
END $$;

ROLLBACK;
\echo forging tenancy: ok

-- raw_materials row-level security, migrations 966 and 967.
-- LOCAL Postgres only (npm run local:up with the baseline loaded): the real policies, is_user_authorized() and
-- current_user_org_ids() are needed. One transaction, always rolled back. Never point this at a shared database.
--   docker exec -i emithran-local-data-postgres-1 psql -U postgres -v ON_ERROR_STOP=1 -q < backend/test/local/raw_materials_rls.local.test.sql
-- Result rows are 'keeps' (must hold before AND after 966/967: nothing legitimate is broken) or 'fixed' (fails before, passes after).
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'rls-a@example.test'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'rls-b@example.test'),
  ('cccccccc-0000-4000-8000-00000000000c', 'rls-platform@example.test');
INSERT INTO authorized_users (email, is_active) VALUES ('rls-a@example.test', true), ('rls-b@example.test', true), ('rls-platform@example.test', true);
INSERT INTO organizations (id, name, owner_id) VALUES
  ('aaaaaaaa-1111-4000-8000-00000000000a', 'RLS test org A', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-1111-4000-8000-00000000000b', 'RLS test org B', 'bbbbbbbb-0000-4000-8000-00000000000b');
INSERT INTO organization_members (organization_id, user_id, status) VALUES
  ('aaaaaaaa-1111-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-00000000000a', 'active'),
  ('bbbbbbbb-1111-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-00000000000b', 'active');
INSERT INTO platform_admins (user_id, granted_by) VALUES ('cccccccc-0000-4000-8000-00000000000c', 'cccccccc-0000-4000-8000-00000000000c');

-- The leak case (org set, no user), a global row, a migration-349-style row (no org, user stamped),
-- three rows A owns with no organisation, and org B's own row.
INSERT INTO raw_materials (material_group, grade, name, organization_id, user_id) VALUES
  ('Forging', 'RLS-LEAK',   'RLS leak',      'aaaaaaaa-1111-4000-8000-00000000000a', NULL),
  ('Forging', 'RLS-GLOBAL', 'RLS global',    NULL, NULL),
  ('Forging', 'RLS-349',    'RLS 349 style', NULL, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('Forging', 'RLS-UPD',    'RLS upd',       NULL, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('Forging', 'RLS-MOVE',   'RLS move',      NULL, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('Forging', 'RLS-DEL',    'RLS del',       NULL, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('Forging', 'RLS-ORGB',   'RLS org B row', 'bbbbbbbb-1111-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-00000000000b');

CREATE TEMP TABLE res (n serial, kind text, what text, ok boolean);
GRANT ALL ON res TO PUBLIC;
GRANT ALL ON SEQUENCE res_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.chk(kind text, what text, ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO res (kind, what, ok) VALUES (kind, what, ok) $$;
CREATE FUNCTION pg_temp.sees(g text) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS (SELECT 1 FROM raw_materials WHERE grade = g) $$;
-- true when the statement is refused by row-level security (SQLSTATE 42501)
CREATE FUNCTION pg_temp.refused(stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE FUNCTION pg_temp.rows_changed(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int; BEGIN EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;

GRANT EXECUTE ON FUNCTION pg_temp.chk(text, text, boolean), pg_temp.sees(text), pg_temp.refused(text), pg_temp.rows_changed(text) TO PUBLIC;

-- ---- org A's user ----
SET LOCAL request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-00000000000a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.chk('keeps', 'A sees its own organisation row', pg_temp.sees('RLS-LEAK'));
SELECT pg_temp.chk('keeps', 'A sees the global row and the 349-style row', pg_temp.sees('RLS-GLOBAL') AND pg_temp.sees('RLS-349'));
SELECT pg_temp.chk('keeps', 'A edits its own no-organisation row', pg_temp.rows_changed($$UPDATE raw_materials SET scrap_factor = 1.1 WHERE grade = 'RLS-UPD'$$) = 1);
SELECT pg_temp.chk('keeps', 'A deletes its own no-organisation row', pg_temp.rows_changed($$DELETE FROM raw_materials WHERE grade = 'RLS-DEL'$$) = 1);
SELECT pg_temp.chk('keeps', 'A inserts a row in its own organisation', NOT pg_temp.refused($$INSERT INTO raw_materials (material_group, grade, name, organization_id, user_id) VALUES ('Forging','RLS-NEW-ORG','x','aaaaaaaa-1111-4000-8000-00000000000a','aaaaaaaa-0000-4000-8000-00000000000a')$$));
SELECT pg_temp.chk('keeps', 'A inserts a row with no organisation', NOT pg_temp.refused($$INSERT INTO raw_materials (material_group, grade, name, user_id) VALUES ('Forging','RLS-NEW-NONE','x','aaaaaaaa-0000-4000-8000-00000000000a')$$));
SELECT pg_temp.chk('keeps', 'A cannot delete org B row', pg_temp.rows_changed($$DELETE FROM raw_materials WHERE grade = 'RLS-ORGB'$$) = 0);
SELECT pg_temp.chk('fixed', 'A cannot insert a row into org B', pg_temp.refused($$INSERT INTO raw_materials (material_group, grade, name, organization_id, user_id) VALUES ('Forging','RLS-XT','x','bbbbbbbb-1111-4000-8000-00000000000b','aaaaaaaa-0000-4000-8000-00000000000a')$$));
SELECT pg_temp.chk('fixed', 'A cannot move its own row into org B', pg_temp.refused($$UPDATE raw_materials SET organization_id = 'bbbbbbbb-1111-4000-8000-00000000000b' WHERE grade = 'RLS-MOVE'$$));
RESET ROLE;

-- ---- org B's user ----
SET LOCAL request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-00000000000b';
SET LOCAL ROLE authenticated;
SELECT pg_temp.chk('keeps', 'B sees its own row, the global row and the 349-style row', pg_temp.sees('RLS-ORGB') AND pg_temp.sees('RLS-GLOBAL') AND pg_temp.sees('RLS-349'));
SELECT pg_temp.chk('fixed', 'B cannot see org A row (org set, user null)', NOT pg_temp.sees('RLS-LEAK'));
RESET ROLE;

-- ---- a platform administrator who belongs to no organisation: an ordinary caller as far as this table goes ----
SET LOCAL request.jwt.claim.sub = 'cccccccc-0000-4000-8000-00000000000c';
SET LOCAL ROLE authenticated;
SELECT pg_temp.chk('keeps', 'platform admin sees the global and 349-style rows', pg_temp.sees('RLS-GLOBAL') AND pg_temp.sees('RLS-349'));
SELECT pg_temp.chk('fixed', 'platform admin does not see org A row through the table', NOT pg_temp.sees('RLS-LEAK'));
RESET ROLE;

-- ---- privileged backend flows (the service role bypasses row-level security): unchanged ----
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL ROLE service_role;
SELECT pg_temp.chk('keeps', 'service_role reads every row', pg_temp.sees('RLS-LEAK') AND pg_temp.sees('RLS-ORGB'));
SELECT pg_temp.chk('keeps', 'service_role writes into any organisation', NOT pg_temp.refused($$INSERT INTO raw_materials (material_group, grade, name, organization_id) VALUES ('Forging','RLS-SVC','x','bbbbbbbb-1111-4000-8000-00000000000b')$$));
RESET ROLE;

SELECT n, kind, what, CASE WHEN ok THEN 'ok' ELSE 'FAIL' END AS result FROM res ORDER BY n;

DO $$
DECLARE bad_keeps int; bad_fixed int;
BEGIN
  SELECT count(*) FILTER (WHERE kind = 'keeps' AND NOT ok), count(*) FILTER (WHERE kind = 'fixed' AND NOT ok) INTO bad_keeps, bad_fixed FROM res;
  ASSERT bad_keeps = 0, bad_keeps || ' behaviour(s) that must keep working are broken';
  ASSERT bad_fixed = 0, bad_fixed || ' leak(s) still open';
END $$;

ROLLBACK;
\echo raw_materials rls: ok

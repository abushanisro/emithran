-- Migration 919: audit_events. Row-level security, who can write, append-only, size limits, retention.
\set ON_ERROR_STOP on

-- fixtures: two organizations; an owner and a plain member of org A; an admin of org B
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002', 'member'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003', 'admin');

-- the service writes through the one function
SET ROLE service_role;
SELECT record_audit_event('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'user',
                          'bom_item.deleted', 'bom_item', 'item-1', 'ok', '203.0.113.9', 'req-1', '{"name":"Bracket"}');
SELECT record_audit_event('bbbbbbbb-0000-0000-0000-000000000002', NULL, 'system', 'upload.completed', 'cad_upload', 'u-1', NULL, NULL, NULL, NULL);
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM audit_events) = 2, 'both events were recorded';
  ASSERT (SELECT outcome FROM audit_events WHERE action = 'upload.completed') = 'ok', 'outcome defaults to ok';
  ASSERT (SELECT meta FROM audit_events WHERE action = 'upload.completed') = '{}'::jsonb, 'missing meta becomes an empty object';
  ASSERT (SELECT host(ip) FROM audit_events WHERE action = 'bom_item.deleted') = '203.0.113.9', 'the client address is kept';
END $$;

-- reading: an admin sees their own organization only; a plain member and anonymous see nothing
SELECT set_config('test.uid', '11111111-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM audit_events) = 1, 'the owner of A sees exactly the events of A';
  ASSERT (SELECT action FROM audit_events) = 'bom_item.deleted', 'and not the events of B';
END $$;
RESET ROLE;

SELECT set_config('test.uid', '11111111-0000-0000-0000-000000000002', false);
SET ROLE authenticated;
DO $$ BEGIN ASSERT (SELECT count(*) FROM audit_events) = 0, 'a plain member of A sees nothing'; END $$;
RESET ROLE;

SELECT set_config('test.uid', '11111111-0000-0000-0000-000000000003', false);
SET ROLE authenticated;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM audit_events) = 1, 'the admin of B sees the events of B';
  ASSERT (SELECT action FROM audit_events) = 'upload.completed', 'and only those';
END $$;
RESET ROLE;

-- writing: the API roles can neither insert nor call the writer
DO $$
DECLARE denied boolean;
BEGIN
  SET LOCAL ROLE authenticated;
  denied := false;
  BEGIN INSERT INTO audit_events (actor_kind, action) VALUES ('user', 'a.b'); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'a signed-in user cannot insert directly';
  denied := false;
  BEGIN PERFORM record_audit_event(NULL, NULL, 'user', 'a.b', NULL, NULL, NULL, NULL, NULL, NULL); EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'a signed-in user cannot call the writer';
  denied := false;
  BEGIN DELETE FROM audit_events; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'a signed-in user cannot delete';
END $$;
DO $$
DECLARE denied boolean := false;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN PERFORM count(*) FROM audit_events; EXCEPTION WHEN insufficient_privilege THEN denied := true; END;
  ASSERT denied, 'an anonymous caller cannot even read';
END $$;

-- append-only: not even the table owner can change or remove a row (or truncate), outside the retention function
DO $$
DECLARE blocked boolean;
BEGIN
  blocked := false; BEGIN UPDATE audit_events SET action = 'x.y'; EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  ASSERT blocked, 'update is blocked';
  blocked := false; BEGIN DELETE FROM audit_events; EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  ASSERT blocked, 'delete is blocked';
  blocked := false; BEGIN TRUNCATE audit_events; EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  ASSERT blocked, 'truncate is blocked';
  ASSERT (SELECT count(*) FROM audit_events) = 2, 'and nothing was lost';
END $$;

-- what a row may hold
DO $$
DECLARE rejected boolean;
BEGIN
  rejected := false; BEGIN PERFORM record_audit_event(NULL, NULL, 'system', 'Not Valid', NULL, NULL, NULL, NULL, NULL, NULL); EXCEPTION WHEN check_violation THEN rejected := true; END;
  ASSERT rejected, 'an action must look like area.verb';
  rejected := false; BEGIN PERFORM record_audit_event(NULL, NULL, 'robot', 'a.b', NULL, NULL, NULL, NULL, NULL, NULL); EXCEPTION WHEN check_violation THEN rejected := true; END;
  ASSERT rejected, 'the actor kind is one of user, service, system';
  rejected := false; BEGIN PERFORM record_audit_event(NULL, NULL, 'system', 'a.b', NULL, NULL, 'maybe', NULL, NULL, NULL); EXCEPTION WHEN check_violation THEN rejected := true; END;
  ASSERT rejected, 'the outcome is ok, denied or error';
  rejected := false; BEGIN PERFORM record_audit_event(NULL, NULL, 'system', 'a.b', NULL, NULL, NULL, NULL, NULL, '[1,2]'::jsonb); EXCEPTION WHEN check_violation THEN rejected := true; END;
  ASSERT rejected, 'meta must be an object';
  rejected := false; BEGIN PERFORM record_audit_event(NULL, NULL, 'system', 'a.b', NULL, NULL, NULL, NULL, NULL, jsonb_build_object('blob', repeat('x', 3000))); EXCEPTION WHEN check_violation THEN rejected := true; END;
  ASSERT rejected, 'meta is capped below 2 KB, so a row stays small';
END $$;

-- retention: 90 days by default, configurable per database; the delete is allowed only inside the function
DO $$
DECLARE removed bigint;
BEGIN
  INSERT INTO audit_events (at, actor_kind, action) VALUES (now() - interval '100 days', 'system', 'old.event'), (now() - interval '30 days', 'system', 'recent.event');
  removed := prune_audit_events();
  ASSERT removed = 1, 'exactly the 100 day old event is pruned';
END $$;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM audit_events WHERE action = 'old.event'), 'the old event is gone';
  ASSERT EXISTS (SELECT 1 FROM audit_events WHERE action = 'recent.event'), 'the 30 day old event stays';
END $$;

DO $$
DECLARE removed bigint;
BEGIN
  PERFORM set_config('app.audit_retention_days', '10', true);   -- what ALTER DATABASE ... SET would configure
  removed := prune_audit_events();
  ASSERT removed >= 1, 'a shorter retention removes the 30 day old event';
END $$;
DO $$
BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM audit_events WHERE action = 'recent.event'), 'and it is gone';
END $$;

-- the allowance is closed again straight after the delete, even within the same transaction
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM prune_audit_events();
  BEGIN DELETE FROM audit_events; EXCEPTION WHEN insufficient_privilege THEN blocked := true; END;
  ASSERT blocked, 'after pruning the table is append-only again, in the same transaction';
  ASSERT NOT has_function_privilege('authenticated', 'prune_audit_events()', 'EXECUTE'), 'only the service may prune';
END $$;

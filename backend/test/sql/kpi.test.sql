-- 933: the KPI views count the right things (terminal states only), expose no identifier, and are readable by grafana_reader alone.
INSERT INTO public.boms (id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.cad_uploads (organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path, status, started_at, finished_at, created_at) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'secret-customer-part.zip', 's1', 1, 'p/1', 'done',   '2026-10-01 10:00:00+00', '2026-10-01 10:00:10+00', '2026-10-01 09:59:00+00'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'b.zip', 's2', 1, 'p/2', 'done',   '2026-10-01 11:00:00+00', '2026-10-01 11:00:30+00', '2026-10-01 10:59:00+00'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'c.zip', 's3', 1, 'p/3', 'failed', '2026-10-01 12:00:00+00', '2026-10-01 12:00:05+00', '2026-10-01 11:59:00+00'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'd.zip', 's4', 1, 'p/4', 'running', '2026-10-02 12:00:00+00', NULL, '2026-10-02 11:59:00+00'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'e.zip', 's5', 1, 'p/5', 'queued',  NULL, NULL, now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'f.zip', 's6', 1, 'p/6', 'analysed', NULL, NULL, now() - interval '5 minutes');

SET ROLE service_role;
SELECT record_audit_event('aaaaaaaa-0000-0000-0000-000000000001', NULL, 'system', 'upload.completed', 'cad_upload', 'u1', 'ok', NULL, NULL, '{"fileName":"secret-customer-part.zip","parts":3,"items":7,"durationMs":10000}');
SELECT record_audit_event('aaaaaaaa-0000-0000-0000-000000000001', NULL, 'system', 'upload.completed', 'cad_upload', 'u2', 'ok', NULL, NULL, '{"fileName":"b.zip","parts":1,"items":1,"durationMs":30000}');
SELECT record_audit_event('bbbbbbbb-0000-0000-0000-000000000002', NULL, 'system', 'upload.failed', 'cad_upload', 'u3', 'error', NULL, NULL, '{"fileName":"c.zip","errorCode":"x"}');
SELECT record_audit_event('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'user', 'cost.applied', 'bom_item', 'i1', 'ok', NULL, NULL, '{"route":"Fiber Laser","custom":false}');
SELECT record_audit_event('bbbbbbbb-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003', 'user', 'cost.applied', 'bom_item', 'i2', 'ok', NULL, NULL, '{"route":"Press Brake","custom":false}');
SELECT record_audit_event('bbbbbbbb-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003', 'user', 'rfq.sent', 'rfq', 'r1', 'ok', NULL, NULL, '{"recipients":2}');
SELECT record_audit_event(NULL, NULL, 'user', 'auth.forbidden', NULL, NULL, 'denied', NULL, NULL, '{"reason":"org"}');
RESET ROLE;

DO $$
DECLARE r record;
BEGIN
  -- terminal states only: 2 done + 1 failed on the 1st; the running upload on the 2nd does not appear at all
  SELECT * INTO r FROM kpi.cad_processing_daily WHERE day = '2026-10-01';
  ASSERT r.completed = 2 AND r.failed = 1, 'done and failed are counted';
  ASSERT r.success_rate_pct = 66.7, 'success rate is done / (done + failed): ' || r.success_rate_pct;
  ASSERT r.avg_seconds = 20.0, 'average duration of done uploads only: ' || r.avg_seconds;
  ASSERT (SELECT count(*) FROM kpi.cad_processing_daily) = 1, 'a running or queued upload is neither a success nor a failure';

  SELECT * INTO r FROM kpi.bom_extraction_daily WHERE day = (now() AT TIME ZONE 'UTC')::date;
  ASSERT r.uploads_completed = 2 AND r.bom_items_created = 8 AND r.distinct_parts = 4 AND r.avg_seconds = 20.0, 'extraction totals';

  ASSERT (SELECT analyses_applied FROM kpi.costing_daily WHERE day = (now() AT TIME ZONE 'UTC')::date) = 2, 'cost.applied counted across organizations';
  ASSERT (SELECT rfqs_sent FROM kpi.rfq_daily WHERE day = (now() AT TIME ZONE 'UTC')::date) = 1, 'rfq.sent counted';
  ASSERT (SELECT active_organizations FROM kpi.active_orgs_daily WHERE day = (now() AT TIME ZONE 'UTC')::date) = 2, 'two organizations, and the denied request adds none';

  SELECT * INTO r FROM kpi.cad_queue_now;
  ASSERT r.waiting = 2, 'queued + analysed wait for a runner; a running one does not';
  ASSERT r.oldest_seconds BETWEEN 290 AND 400, 'oldest age is the analysed one, about 5 minutes: ' || r.oldest_seconds;

  SELECT * INTO r FROM kpi.database_now;
  ASSERT r.db_bytes > 0 AND r.max_connections > 0 AND r.connections >= 1, 'database size and sessions are reported';
  ASSERT r.deadlocks >= 0 AND r.xact_commit >= 0 AND r.xact_rollback >= 0, 'transaction counters are reported';

  -- no identifier of any kind is exposed
  ASSERT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'kpi' AND column_name ~* '(org|user|actor|file|name|bom|item_id|target|email|ip|meta|detail|path)' AND column_name NOT IN ('bom_items_created', 'distinct_parts', 'active_organizations')
  ), 'the views expose no organization, user, file or BOM identifier';
END $$;

-- who can read: grafana_reader only
ALTER ROLE grafana_reader WITH LOGIN;
SET ROLE grafana_reader;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM kpi.costing_daily) = 1, 'the reader sees the views';
  ASSERT (SELECT db_bytes FROM kpi.database_now) > 0, 'and the database view, without pg_monitor';
  BEGIN PERFORM 1 FROM public.cad_uploads LIMIT 1; ASSERT false, 'the reader must not read the tables behind the views';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.audit_events LIMIT 1; ASSERT false, 'nor the audit trail';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN EXECUTE 'DELETE FROM kpi.costing_daily'; ASSERT false, 'nor change anything';
  EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;

DO $$ DECLARE who text; BEGIN
  FOREACH who IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    ASSERT NOT has_schema_privilege(who, 'kpi', 'USAGE'), who || ' must not use the kpi schema';
    ASSERT NOT has_table_privilege(who, 'kpi.costing_daily', 'SELECT'), who || ' must not read the kpi views';
  END LOOP;
  ASSERT NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'grafana_reader') IS NULL, 'the role exists';
END $$;

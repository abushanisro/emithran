-- 951: the analysis runner's role can claim a queued upload and finish a running one, and nothing else.
INSERT INTO public.boms (id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.cad_uploads (id, organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path, status, created_at) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'a.zip', 'sa', 1, 'p/a', 'queued', now() - interval '3 minutes'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'b.zip', 'sb', 1, 'p/b', 'queued', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'c.zip', 'sc', 1, 'p/c', 'queued', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'd.zip', 'sd', 1, 'p/d', 'analysed', now());

-- The role itself: no login, no RLS bypass, reachable through PostgREST, and no privilege on any table, view or sequence.
DO $$
DECLARE r pg_roles;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'cad_runner';
  ASSERT FOUND, 'cad_runner exists';
  ASSERT NOT r.rolcanlogin AND NOT r.rolbypassrls AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb, 'cad_runner is a plain NOLOGIN role';
  ASSERT pg_has_role('authenticator', 'cad_runner', 'MEMBER'), 'PostgREST (authenticator) can switch to cad_runner';
  ASSERT NOT pg_has_role('cad_runner', 'service_role', 'MEMBER'), 'cad_runner is not the service role';
  ASSERT (SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'cad_runner') = 0, 'no table or view privilege';
  ASSERT (SELECT count(*) FROM information_schema.role_column_grants WHERE grantee = 'cad_runner') = 0, 'no column privilege';
  ASSERT (SELECT count(*) FROM information_schema.role_usage_grants WHERE grantee = 'cad_runner' AND object_type = 'SEQUENCE') = 0, 'no sequence privilege';
  ASSERT has_function_privilege('cad_runner', 'public.claim_next_cad_upload(integer, integer)', 'EXECUTE'), 'cad_runner can claim';
  ASSERT has_function_privilege('cad_runner', 'public.cad_runner_mark_analysed(uuid, jsonb)', 'EXECUTE'), 'cad_runner can mark analysed';
  ASSERT has_function_privilege('cad_runner', 'public.cad_runner_mark_failed(uuid, boolean, text, text)', 'EXECUTE'), 'cad_runner can mark failed';
  ASSERT NOT has_function_privilege('cad_runner', 'public.claim_next_analysed_upload(integer, integer)', 'EXECUTE'), 'the materializer''s claim is not the runner''s';
  ASSERT NOT has_function_privilege('authenticated', 'public.cad_runner_mark_analysed(uuid, jsonb)', 'EXECUTE'), 'signed-in users cannot finish an upload';
  ASSERT NOT has_function_privilege('anon', 'public.cad_runner_mark_failed(uuid, boolean, text, text)', 'EXECUTE'), 'visitors cannot fail an upload';
END
$$;

-- What the runner does, as the runner.
SET ROLE cad_runner;
DO $$
DECLARE got public.cad_uploads; ok boolean;
BEGIN
  SELECT * INTO got FROM claim_next_cad_upload(1800, 3);
  ASSERT got.id = '00000000-0000-0000-0000-000000000001' AND got.status = 'running' AND got.attempts = 1, 'claims the oldest queued upload';
  ASSERT cad_runner_mark_analysed(got.id, '{"report":{}}'), 'finishes the upload it claimed';
  ASSERT NOT cad_runner_mark_analysed(got.id, '{"report":{"forged":true}}'), 'an upload that is no longer running is not changed';
  ASSERT NOT cad_runner_mark_failed('00000000-0000-0000-0000-000000000004', false, 'x', 'y'), 'an analysed upload cannot be failed';
  ASSERT NOT cad_runner_mark_analysed('00000000-0000-0000-0000-000000000003', '{}'), 'a queued upload it did not claim cannot be finished';

  SELECT * INTO got FROM claim_next_cad_upload(1800, 3);
  ASSERT cad_runner_mark_failed(got.id, true, 'processing_failed', 'try again'), 'a retry';
  SELECT * INTO got FROM claim_next_cad_upload(1800, 3);
  ASSERT got.id = '00000000-0000-0000-0000-000000000002' AND got.attempts = 2, 'a retried upload is queued again and claimed with one more attempt';
  ASSERT cad_runner_mark_failed(got.id, false, 'unreadable_step', repeat('d', 2000)), 'a permanent failure';

  BEGIN
    PERFORM 1 FROM public.cad_uploads;
    ASSERT false, 'cad_runner must not read cad_uploads directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.cad_uploads SET status = 'done';
    ASSERT false, 'cad_runner must not write cad_uploads directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.boms;
    ASSERT false, 'cad_runner must not read other tables';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

DO $$
DECLARE a public.cad_uploads; b public.cad_uploads; c public.cad_uploads;
BEGIN
  SELECT * INTO a FROM cad_uploads WHERE id = '00000000-0000-0000-0000-000000000001';
  SELECT * INTO b FROM cad_uploads WHERE id = '00000000-0000-0000-0000-000000000002';
  SELECT * INTO c FROM cad_uploads WHERE id = '00000000-0000-0000-0000-000000000003';
  ASSERT a.status = 'analysed' AND a.result = '{"report":{}}' AND a.error_code IS NULL, 'the first report is kept, the second was refused';
  ASSERT b.status = 'failed' AND b.error_code = 'unreadable_step' AND length(b.error_detail) = 500 AND b.finished_at IS NOT NULL, 'failed for good, detail bounded';
  ASSERT c.status = 'queued' AND c.attempts = 0, 'the upload nobody claimed is untouched';
END
$$;

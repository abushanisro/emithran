-- 923: analysed uploads are claimed by the materializer only; the analysis runner never touches them; attempts are bounded.
INSERT INTO public.boms (id) VALUES ('00000000-0000-0000-0000-0000000000b1');
INSERT INTO public.cad_uploads (id, organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path, status) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'a.zip', 'sa', 1, 'p/a', 'analysed'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'b.zip', 'sb', 1, 'p/b', 'queued');

DO $$
DECLARE got public.cad_uploads; n integer;
BEGIN
  -- the analysis runner claims the queued one and cannot see the analysed one
  SELECT * INTO got FROM claim_next_cad_upload();
  ASSERT got.id = '00000000-0000-0000-0000-000000000002' AND got.status = 'running', 'the analysis runner takes the queued upload';
  SELECT count(*) INTO n FROM claim_next_cad_upload();
  ASSERT n = 0, 'the analysis runner never claims an analysed upload';

  -- the materializer claims the analysed one, once
  SELECT * INTO got FROM claim_next_analysed_upload();
  ASSERT got.id = '00000000-0000-0000-0000-000000000001' AND got.status = 'materializing' AND got.materialize_attempts = 1, 'the materializer takes the analysed upload';
  SELECT count(*) INTO n FROM claim_next_analysed_upload();
  ASSERT n = 0, 'a materializing upload is not claimed twice';

  -- a crashed materializer: stale -> claimed again; out of attempts -> failed
  UPDATE cad_uploads SET started_at = now() - interval '1 hour' WHERE id = '00000000-0000-0000-0000-000000000001';
  SELECT * INTO got FROM claim_next_analysed_upload(900, 3);
  ASSERT got.materialize_attempts = 2, 'a stale materializing upload is claimed again';
  UPDATE cad_uploads SET started_at = now() - interval '1 hour', materialize_attempts = 3 WHERE id = '00000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM claim_next_analysed_upload(900, 3);
  ASSERT n = 0 AND (SELECT status FROM cad_uploads WHERE id = '00000000-0000-0000-0000-000000000001') = 'failed', 'out of attempts it is failed, not claimed';

  ASSERT NOT has_function_privilege('authenticated', 'public.claim_next_analysed_upload(integer, integer)', 'EXECUTE'), 'API roles cannot claim';
  ASSERT has_function_privilege('service_role', 'public.claim_next_analysed_upload(integer, integer)', 'EXECUTE'), 'the service role can';
END
$$;

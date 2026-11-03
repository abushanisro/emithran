-- 955: casting analyses are claimed oldest first, attempts are bounded, only the service role claims or writes, and users see
-- only their own organization's rows.
INSERT INTO public.bom_items (id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2');
INSERT INTO public.casting_analyses (id, organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash, status, created_at) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.12.0', 1, 'auto', 'queued', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.12.0', 1, 'auto', 'queued', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c2', 'sb', '0.12.0', 1, 'auto', 'succeeded', now());

DO $$
DECLARE got public.casting_analyses; n integer;
BEGIN
  SELECT * INTO got FROM claim_next_casting_analysis();
  ASSERT got.id = '00000000-0000-0000-0000-000000000001' AND got.status = 'running' AND got.attempts = 1, 'claims the oldest queued analysis';
  SELECT * INTO got FROM claim_next_casting_analysis();
  ASSERT got.id = '00000000-0000-0000-0000-000000000002', 'the next claim takes the next one, not the running one';
  SELECT count(*) INTO n FROM claim_next_casting_analysis();
  ASSERT n = 0, 'a running analysis is not claimed again, and a succeeded one never';

  -- a runner that died: the row is claimed again after the stale time, and failed for good after the last attempt
  UPDATE public.casting_analyses SET started_at = now() - interval '1 hour' WHERE id = '00000000-0000-0000-0000-000000000001';
  SELECT * INTO got FROM claim_next_casting_analysis(900, 3);
  ASSERT got.id = '00000000-0000-0000-0000-000000000001' AND got.attempts = 2, 'a stale running analysis is claimed again with one more attempt';
  UPDATE public.casting_analyses SET started_at = now() - interval '1 hour', attempts = 3 WHERE id = '00000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO n FROM claim_next_casting_analysis(900, 3);
  ASSERT n = 0, 'after the last attempt it is not claimed';
  SELECT * INTO got FROM public.casting_analyses WHERE id = '00000000-0000-0000-0000-000000000001';
  ASSERT got.status = 'failed' AND got.error_code = 'worker_crashed', 'and is failed with worker_crashed';
END
$$;

-- the same file, version and configuration twice for one BOM item is one row
DO $$
BEGIN
  BEGIN
    INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'sa', '0.12.0', 1, 'auto');
    ASSERT false, 'a duplicate key must be refused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash, status)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sz', '0.12.0', 1, 'auto', 'passed');
    ASSERT false, 'an unknown status must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

-- users: read their own organization only, change nothing, claim nothing
SET ROLE authenticated;
SET test.org_ids = '00000000-0000-0000-0000-0000000000a1';
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.casting_analyses;
  ASSERT n = 2, 'a user sees the rows of their own organization only';
  SELECT count(*) INTO n FROM public.casting_analyses WHERE organization_id = '00000000-0000-0000-0000-0000000000a2';
  ASSERT n = 0, 'and none of another organization';
  BEGIN
    INSERT INTO public.casting_analyses (organization_id, bom_item_id, requested_by, input_sha256, worker_version, schema_version, config_hash)
    VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'sx', '0.12.0', 1, 'auto');
    ASSERT false, 'a user cannot insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- no UPDATE policy exists, so with row-level security an update either is refused or changes no row
  BEGIN
    UPDATE public.casting_analyses SET status = 'succeeded';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, 'a user cannot update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM claim_next_casting_analysis();
    ASSERT false, 'a user cannot claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

SET ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM public.casting_analyses;
    ASSERT false, 'a visitor cannot read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;

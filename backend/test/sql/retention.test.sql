-- Migration 918: bounded retention, and the "is this storage path still referenced" check. Each block ASSERTs.
\set ON_ERROR_STOP on

DO $$
DECLARE r jsonb; org uuid := gen_random_uuid(); item uuid := gen_random_uuid(); other uuid := gen_random_uuid(); bom uuid := gen_random_uuid(); n int;
BEGIN
  INSERT INTO boms (id) VALUES (bom);

  -- request log: old rows go, recent rows stay
  INSERT INTO api_request_logs (created_at) VALUES (now() - interval '20 days'), (now() - interval '2 days');
  -- fx: an old row goes, but the newest rate of a pair is kept even when it is old
  INSERT INTO fx_rate_snapshots (provider, base_currency, quote_currency, rate, rate_date, created_at) VALUES
    ('p','USD','INR',83,'2026-01-01', now() - interval '200 days'),  -- newest of USD/INR, old: kept
    ('p','USD','EUR',0.9,'2026-01-01', now() - interval '200 days'),
    ('p','USD','EUR',0.91,'2026-08-01', now() - interval '100 days'), -- newest of USD/EUR, old: kept; the one above goes
    ('p','USD','GBP',0.8,'2026-10-01', now() - interval '3 days');
  -- history: the last 3 per item
  INSERT INTO cad_analysis_history (bom_item_id, created_at) SELECT item, now() - (g || ' days')::interval FROM generate_series(1,5) g;
  INSERT INTO cad_analysis_history (bom_item_id, created_at) SELECT other, now() - (g || ' days')::interval FROM generate_series(1,2) g;
  -- uploads: an old failed one goes; a recent failed one and an old done one stay
  INSERT INTO cad_uploads (organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path, status, finished_at) VALUES
    (org, org, bom, 'a.zip', 'h1', 1, 'p1', 'failed', now() - interval '40 days'),
    (org, org, bom, 'b.zip', 'h2', 1, 'p2', 'failed', now() - interval '5 days'),
    (org, org, bom, 'c.zip', 'h3', 1, 'p3', 'done',   now() - interval '90 days');

  r := prune_old_rows();

  ASSERT (SELECT count(*) FROM api_request_logs) = 1, 'old request logs removed, recent kept';
  ASSERT (SELECT count(*) FROM fx_rate_snapshots) = 3, 'one superseded old FX row removed, newest per pair kept';
  ASSERT (SELECT count(*) FROM fx_rate_snapshots WHERE quote_currency = 'INR') = 1, 'the only (old) INR rate is never pruned';
  ASSERT (SELECT count(*) FROM cad_analysis_history WHERE bom_item_id = item) = 3, 'history trimmed to 3 per item';
  ASSERT (SELECT count(*) FROM cad_analysis_history WHERE bom_item_id = other) = 2, 'a short history is left alone';
  ASSERT (SELECT count(*) FROM cad_uploads WHERE sha256 = 'h1') = 0, 'old failed upload removed';
  ASSERT (SELECT count(*) FROM cad_uploads WHERE sha256 IN ('h2','h3')) = 2, 'recent failed and old done uploads kept';
  ASSERT (r ->> 'api_request_logs')::int = 1 AND (r ->> 'cad_analysis_history')::int = 2, 'the function reports what it removed';
END $$;

-- file_paths_in_use: reads every file_*_path column that exists, even one added later
DO $$
DECLARE org uuid := gen_random_uuid(); bom uuid := gen_random_uuid(); used text[];
BEGIN
  ALTER TABLE bom_items ADD COLUMN file_step_path text;  -- a column the function was not written against
  INSERT INTO bom_items (file_3d_path, file_2d_path, file_dxf_path, file_step_path) VALUES ('a/3d.step', 'a/2d.pdf', 'a/x.dxf.gz', 'a/s.step');
  INSERT INTO cad_uploads (organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path, source_deleted_at) VALUES
    (org, org, (SELECT id FROM boms LIMIT 1), 'live.zip', 'u1', 1, 'up/live.zip', NULL),
    (org, org, (SELECT id FROM boms LIMIT 1), 'gone.zip', 'u2', 1, 'up/gone.zip', now());

  used := file_paths_in_use(ARRAY['a/3d.step','a/2d.pdf','a/x.dxf.gz','a/s.step','a/orphan.step','up/live.zip','up/gone.zip']);
  ASSERT used @> ARRAY['a/3d.step','a/2d.pdf','a/x.dxf.gz','a/s.step'], 'every file_*_path column counts, including a new one';
  ASSERT 'up/live.zip' = ANY(used), 'an upload original that has not been removed is in use (a retry reads it)';
  ASSERT NOT ('up/gone.zip' = ANY(used)), 'an upload original already removed is not';
  ASSERT NOT ('a/orphan.step' = ANY(used)), 'an unreferenced path is not in use';
  ASSERT file_paths_in_use(ARRAY[]::text[]) = '{}', 'an empty question has an empty answer';
END $$;

-- one missing table must not stop the other prunes
DO $$
DECLARE r jsonb;
BEGIN
  DROP TABLE api_request_logs;
  r := prune_old_rows();
  ASSERT r ? 'cad_analysis_history', 'the other prunes still ran';
  ASSERT NOT (r ? 'api_request_logs'), 'the missing table was skipped, not reported';
END $$;

-- only the service may call these
DO $$
BEGIN
  ASSERT NOT has_function_privilege('authenticated', 'prune_old_rows()', 'EXECUTE'), 'signed-in users cannot run the pruner';
  ASSERT NOT has_function_privilege('anon', 'file_paths_in_use(text[])', 'EXECUTE'), 'anonymous users cannot probe storage paths';
  ASSERT has_function_privilege('service_role', 'prune_old_rows()', 'EXECUTE'), 'the backend can';
END $$;

-- 973: reference_data_snapshots holds the reference rows a saved calculation read, by fingerprint: written by the service, read by signed-in users,
-- never changed or removed, and the key must be a fingerprint.
DO $$
DECLARE
  n integer;
BEGIN
  -- the service role stores a copy; storing the same fingerprint again changes nothing (what ON CONFLICT DO NOTHING does for the upsert)
  INSERT INTO public.reference_data_snapshots (fingerprint, source_version, rows) VALUES ('4535281a9a0fd036', '2026-Plastic', '{"variables": []}');
  INSERT INTO public.reference_data_snapshots (fingerprint, source_version, rows) VALUES ('4535281a9a0fd036', '2026-Plastic', '{"variables": [1]}') ON CONFLICT (fingerprint) DO NOTHING;
  SELECT count(*) INTO n FROM public.reference_data_snapshots; ASSERT n = 1, 'one row per fingerprint';
  ASSERT (SELECT rows FROM public.reference_data_snapshots) = '{"variables": []}'::jsonb, 'the first content stays';

  -- the key is a fingerprint, and the rows an object
  BEGIN INSERT INTO public.reference_data_snapshots VALUES ('not-a-fingerprint', 'x', '{}'); ASSERT false, 'a key that is not a fingerprint is refused';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN INSERT INTO public.reference_data_snapshots VALUES ('0123456789abcdef', 'x', '[]'); ASSERT false, 'rows must be an object';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- immutable: neither an edit nor a delete, even by the table owner
  BEGIN UPDATE public.reference_data_snapshots SET rows = '{}'; ASSERT false, 'a snapshot is never edited';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN DELETE FROM public.reference_data_snapshots; ASSERT false, 'a snapshot is never removed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- 974: nor a truncate (a row trigger does not fire for TRUNCATE)
  BEGIN TRUNCATE public.reference_data_snapshots; ASSERT false, 'a snapshot table is never truncated';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT count(*) INTO n FROM public.reference_data_snapshots; ASSERT n = 1, 'the row survived the refused truncate';
END $$;

-- 974: the API roles do not even hold the privilege
DO $$
BEGIN
  ASSERT NOT has_table_privilege('service_role', 'public.reference_data_snapshots', 'TRUNCATE'), 'service_role cannot truncate';
  ASSERT NOT has_table_privilege('authenticated', 'public.reference_data_snapshots', 'TRUNCATE'), 'authenticated cannot truncate';
END $$;

-- who may do what
SET ROLE authenticated;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.reference_data_snapshots) = 1, 'a signed-in user reads the stored rows';
  BEGIN INSERT INTO public.reference_data_snapshots VALUES ('fedcba9876543210', 'x', '{}'); ASSERT false, 'a signed-in user cannot write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM count(*) FROM public.reference_data_snapshots; ASSERT false, 'a visitor cannot read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

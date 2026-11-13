-- 1002: machining allowance data. A licensed dataset is frozen and needs its licence; a foundry/customer profile is frozen once submitted and
-- approved once, by a different admin; a part's decision is append-only (a new one supersedes, nothing is edited), bound to the geometry, and
-- written only through set_machining_allowance(). Organization members read their own organization's rows only.
ALTER TABLE public.bom_items ADD COLUMN IF NOT EXISTS geometry_hash text;
INSERT INTO public.bom_items (id, organization_id, geometry_hash) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', 'geo-1');
INSERT INTO public.organization_members (organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 'owner'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', 'member'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c4', 'viewer');

-- ── licensed datasets ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE d uuid;
BEGIN
  BEGIN
    INSERT INTO public.machining_allowance_datasets (organization_id, standard, edition, licence_reference, content_sha256, imported_by)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'ISO 8062-3', '2023', ' ', 'sha', '00000000-0000-0000-0000-0000000000c1');
    ASSERT false, 'a dataset without a licence reference must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.machining_allowance_datasets (organization_id, standard, edition, licence_reference, content_sha256, imported_by)
  VALUES ('00000000-0000-0000-0000-0000000000a1', 'ISO 8062-3', '2023', 'Order 12345, single-site licence', 'sha-1', '00000000-0000-0000-0000-0000000000c1')
  RETURNING id INTO d;
  INSERT INTO public.machining_allowance_dataset_values (dataset_id, rmag, size_over_mm, size_upto_mm, allowance_mm) VALUES (d, 'F', 100, 160, 1.5);
  BEGIN
    INSERT INTO public.machining_allowance_dataset_values (dataset_id, rmag, size_over_mm, size_upto_mm, allowance_mm) VALUES (d, 'Z', 0, 40, 1);
    ASSERT false, 'a grade outside A-K must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.machining_allowance_dataset_values (dataset_id, rmag, size_over_mm, size_upto_mm, allowance_mm) VALUES (d, 'F', 160, 100, 1);
    ASSERT false, 'a size band whose upper bound is not above its lower bound must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.machining_allowance_dataset_values SET allowance_mm = 9 WHERE dataset_id = d;
    ASSERT false, 'a dataset value must never change';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.machining_allowance_datasets SET licence_reference = 'other' WHERE id = d;
    ASSERT false, 'a dataset must never change';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.machining_allowance_datasets WHERE id = d;
    ASSERT false, 'a dataset must never be deleted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── foundry / customer profiles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE p public.machining_allowance_profiles; q public.machining_allowance_profiles; n int;
BEGIN
  -- a member who is not an admin cannot submit
  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c3', true);
  BEGIN
    PERFORM public.submit_machining_allowance_profile('00000000-0000-0000-0000-0000000000a1', 'Foundry A', 'foundry', 'Foundry A capability sheet rev 3',
      '[{"size_over_mm":0,"size_upto_mm":100,"allowance_mm":1.5}]'::jsonb);
    ASSERT false, 'only an organization admin submits a profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  p := public.submit_machining_allowance_profile('00000000-0000-0000-0000-0000000000a1', 'Foundry A', 'foundry', 'Foundry A capability sheet rev 3',
    '[{"material_family":"Gray Iron","moulding_method":"machine","size_over_mm":0,"size_upto_mm":100,"allowance_mm":1.5},
      {"size_over_mm":100,"size_upto_mm":250,"allowance_mm":2.5}]'::jsonb);
  ASSERT p.status = 'submitted' AND p.version = 1, 'a new profile is submitted, version 1';
  SELECT count(*) INTO n FROM public.machining_allowance_profile_values WHERE profile_id = p.id;
  ASSERT n = 2, 'its values are stored';

  BEGIN
    UPDATE public.machining_allowance_profile_values SET allowance_mm = 9 WHERE profile_id = p.id;
    ASSERT false, 'a submitted profile''s values must never change';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- the submitter cannot approve their own profile
  BEGIN
    PERFORM public.review_machining_allowance_profile(p.id, 'approved', 'checked against the sheet');
    ASSERT false, 'the submitter must not approve their own profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c2', true);
  p := public.review_machining_allowance_profile(p.id, 'approved', 'checked against the sheet');
  ASSERT p.status = 'approved' AND p.reviewed_by = '00000000-0000-0000-0000-0000000000c2', 'a different admin approves it';
  BEGIN
    PERFORM public.review_machining_allowance_profile(p.id, 'rejected', 'changed my mind');
    ASSERT false, 'a profile is reviewed once';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- a new version of the same profile keeps the old one as history
  q := public.submit_machining_allowance_profile('00000000-0000-0000-0000-0000000000a1', 'Foundry A', 'foundry', 'rev 4',
    '[{"size_over_mm":0,"size_upto_mm":100,"allowance_mm":1.2}]'::jsonb);
  ASSERT q.version = 2, 'the next submission of the same profile is version 2';
  SELECT count(*) INTO n FROM public.machining_allowance_profiles WHERE organization_id = '00000000-0000-0000-0000-0000000000a1' AND name = 'Foundry A';
  ASSERT n = 2, 'both versions are kept';

  BEGIN
    PERFORM public.submit_machining_allowance_profile('00000000-0000-0000-0000-0000000000a1', 'Foundry B', 'foundry', 'x', '[{"size_over_mm":0,"size_upto_mm":100,"allowance_mm":-1}]'::jsonb);
    ASSERT false, 'a non-positive allowance must be refused';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── a part's decisions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r public.bom_item_machining_allowances; n int;
BEGIN
  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c4', true);
  BEGIN
    PERFORM public.set_machining_allowance('00000000-0000-0000-0000-0000000000f1', 'SimpleHole:abc', true, 1.5, 2, 'engineering_estimate', 'bore to H7');
    ASSERT false, 'a viewer must not decide';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.uid', '00000000-0000-0000-0000-0000000000c3', true);
  BEGIN
    PERFORM public.set_machining_allowance('00000000-0000-0000-0000-0000000000f1', 'SimpleHole:abc', true, 1.5, 2, 'engineering_estimate', ' ');
    ASSERT false, 'a decision needs a reason';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.set_machining_allowance('00000000-0000-0000-0000-0000000000f1', 'SimpleHole:abc', false, 1.5, 2, 'not_machined', 'cast to size');
    ASSERT false, 'a face that is not machined has no allowance';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  r := public.set_machining_allowance('00000000-0000-0000-0000-0000000000f1', 'SimpleHole:abc', true, 1.5, 2, 'engineering_estimate', 'bore to H7');
  ASSERT r.geometry_hash = 'geo-1' AND r.set_by = '00000000-0000-0000-0000-0000000000c3' AND r.superseded_at IS NULL, 'bound to the geometry and the member';
  r := public.set_machining_allowance('00000000-0000-0000-0000-0000000000f1', 'SimpleHole:abc', true, 2.0, 2, 'engineering_estimate', 'deeper bore');
  SELECT count(*) INTO n FROM public.bom_item_machining_allowances WHERE bom_item_id = '00000000-0000-0000-0000-0000000000f1' AND feature_key = 'SimpleHole:abc';
  ASSERT n = 2, 'a new decision adds a row';
  SELECT count(*) INTO n FROM public.bom_item_machining_allowances WHERE feature_key = 'SimpleHole:abc' AND superseded_at IS NULL;
  ASSERT n = 1, 'only the newest is current';
  SELECT count(*) INTO n FROM public.bom_item_machining_allowances WHERE feature_key = 'SimpleHole:abc' AND superseded_at IS NULL AND allowance_mm = 2.0;
  ASSERT n = 1, 'the current one is the newest';

  BEGIN
    UPDATE public.bom_item_machining_allowances SET allowance_mm = 9 WHERE id = r.id;
    ASSERT false, 'a decision is never edited';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- ── what users may do directly ───────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT NOT has_table_privilege('authenticated', 'public.bom_item_machining_allowances', 'INSERT'), 'decisions are written only through the function';
  ASSERT NOT has_table_privilege('authenticated', 'public.machining_allowance_profiles', 'INSERT'), 'profiles are written only through the functions';
  ASSERT NOT has_table_privilege('authenticated', 'public.machining_allowance_datasets', 'INSERT'), 'datasets are imported by the backend only';
  ASSERT has_table_privilege('authenticated', 'public.bom_item_machining_allowances', 'SELECT'), 'members read decisions';
END $$;

-- ── organizations see only their own rows ────────────────────────────────────────────────────────────────────────────────────────────────
SET ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  PERFORM set_config('test.org_ids', '00000000-0000-0000-0000-0000000000a2', true);
  SELECT count(*) INTO n FROM public.bom_item_machining_allowances;          ASSERT n = 0, 'another organization sees no decisions';
  SELECT count(*) INTO n FROM public.machining_allowance_profiles;           ASSERT n = 0, 'another organization sees no profiles';
  SELECT count(*) INTO n FROM public.machining_allowance_dataset_values;     ASSERT n = 0, 'another organization sees no dataset values';
  PERFORM set_config('test.org_ids', '00000000-0000-0000-0000-0000000000a1', true);
  SELECT count(*) INTO n FROM public.bom_item_machining_allowances;          ASSERT n = 2, 'the organization sees its decisions';
  SELECT count(*) INTO n FROM public.machining_allowance_profile_values;     ASSERT n = 3, 'the organization sees its profile values';
END $$;
RESET ROLE;

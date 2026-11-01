-- 942: SECURITY DEFINER functions a signed-in user can call check the caller's organization (or become SECURITY INVOKER), anon
-- cannot call them, owner-less vave rows are shared with nobody, and organization memberships are written through checked functions.
-- The harness ran 942 on the bare stubs already (a no-op there); the vulnerable state is rebuilt here as the old migrations left
-- it, and 942 is applied again, twice, which also proves it is idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- RFQs (043/552): org-scoped row-level security, but send_rfq/close_rfq trusted the p_user_id the caller passed
CREATE TABLE public.rfq_records (
  id uuid PRIMARY KEY, organization_id uuid, status text NOT NULL DEFAULT 'draft', rfq_number varchar(100) UNIQUE,
  sent_at timestamptz, closed_at timestamptz, updated_at timestamptz
);
ALTER TABLE public.rfq_records ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE ON public.rfq_records TO authenticated;
CREATE POLICY org_select_rfq_records ON public.rfq_records FOR SELECT USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY org_update_rfq_records ON public.rfq_records FOR UPDATE
  USING (organization_id IN (SELECT current_user_org_ids())) WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE FUNCTION public.send_rfq(p_rfq_id uuid, p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rfq_records rr JOIN organization_members om ON om.organization_id = rr.organization_id
                  WHERE rr.id = p_rfq_id AND om.user_id = p_user_id AND om.status = 'active') THEN
    RAISE EXCEPTION 'RFQ not found or unauthorized';
  END IF;
  UPDATE rfq_records SET status = 'sent' WHERE id = p_rfq_id;
END $$;
CREATE FUNCTION public.close_rfq(p_rfq_id uuid, p_user_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rfq_records rr JOIN organization_members om ON om.organization_id = rr.organization_id
                  WHERE rr.id = p_rfq_id AND om.user_id = p_user_id AND om.status = 'active') THEN
    RAISE EXCEPTION 'RFQ not found or unauthorized';
  END IF;
  UPDATE rfq_records SET status = 'closed' WHERE id = p_rfq_id;
END $$;

-- supplier evaluations (042): owned by user_id; freeze_evaluation froze any id for any p_user_id
CREATE TABLE public.supplier_evaluation_records (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, is_frozen boolean NOT NULL DEFAULT false, status text DEFAULT 'draft',
  approved_at timestamptz, approved_by uuid, updated_at timestamptz
);
CREATE TABLE public.supplier_evaluation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), evaluation_id uuid NOT NULL, version integer NOT NULL, snapshot_payload jsonb,
  snapshot_hash text, snapshot_reason text, created_by uuid
);
ALTER TABLE public.supplier_evaluation_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_records ON public.supplier_evaluation_records FOR SELECT USING (auth.uid() = user_id);
CREATE FUNCTION public.freeze_evaluation(p_evaluation_id uuid, p_user_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO supplier_evaluation_snapshots (evaluation_id, version, created_by) VALUES (p_evaluation_id, 1, p_user_id) RETURNING id INTO v;
  UPDATE supplier_evaluation_records SET is_frozen = true, approved_by = p_user_id WHERE id = p_evaluation_id;
  RETURN v;
END $$;

-- vendor rating (064): DEFINER and granted to anon
CREATE FUNCTION public.get_vendor_rating_matrix(p_nomination_evaluation_id uuid, p_vendor_id uuid) RETURNS jsonb
  LANGUAGE sql SECURITY DEFINER AS $$ SELECT '[]'::jsonb $$;

-- what every function had before 921 (and 064's explicit anon grant)
GRANT EXECUTE ON FUNCTION public.send_rfq(uuid, uuid), public.close_rfq(uuid, uuid), public.freeze_evaluation(uuid, uuid),
  public.get_vendor_rating_matrix(uuid, uuid) TO PUBLIC, anon, authenticated;

-- vave (312): owner-less projects were shared with every tenant
CREATE TABLE public.vave_projects (id uuid PRIMARY KEY, owner_id uuid, name text);
CREATE TABLE public.vave_ideas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid);
ALTER TABLE public.vave_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vave_ideas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vave_projects, public.vave_ideas TO authenticated;
CREATE POLICY vave_projects_select ON public.vave_projects FOR SELECT USING (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY vave_projects_insert ON public.vave_projects FOR INSERT WITH CHECK (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY vave_projects_update ON public.vave_projects FOR UPDATE USING (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY vave_projects_delete ON public.vave_projects FOR DELETE USING (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY vave_ideas_all ON public.vave_ideas FOR ALL
  USING (EXISTS (SELECT 1 FROM vave_projects p WHERE p.id = project_id AND (p.owner_id = auth.uid() OR p.owner_id IS NULL)));

-- organizations and organization_members as migration 125 defines them (the stubs carry only a few columns)
ALTER TABLE public.organizations ADD COLUMN owner_id uuid;
ALTER TABLE public.organization_members
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ADD COLUMN invited_email varchar(255),
  ADD COLUMN invited_by uuid,
  ADD COLUMN joined_at timestamptz DEFAULT now(),
  ALTER COLUMN user_id DROP NOT NULL,
  ADD CONSTRAINT organization_members_organization_id_user_id_key UNIQUE (organization_id, user_id);

-- Org A: owner UA, admin AD, member ME. Org B: owner UB. Org C: owned by UA, no memberships yet.
INSERT INTO public.organizations (id, owner_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a0'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-0000000000b0'),
  ('cccccccc-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-0000000000a0');
INSERT INTO public.organization_members (id, organization_id, user_id, role, status) VALUES
  ('10000000-0000-4000-8000-0000000000a0', 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-0000000000a0', 'owner', 'active'),
  ('10000000-0000-4000-8000-0000000000ad', 'aaaaaaaa-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-0000000000ad', 'admin', 'active'),
  ('10000000-0000-4000-8000-0000000000ee', 'aaaaaaaa-0000-4000-8000-000000000001', 'ee000000-0000-4000-8000-0000000000ee', 'member', 'active'),
  ('10000000-0000-4000-8000-0000000000b0', 'bbbbbbbb-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-0000000000b0', 'owner', 'active');
INSERT INTO public.rfq_records (id, organization_id) VALUES
  ('20000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002');
INSERT INTO public.supplier_evaluation_records (id, user_id) VALUES
  ('30000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000a0'),
  ('30000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-0000000000b0');
INSERT INTO public.vave_projects (id, owner_id, name) VALUES
  ('40000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000a0', 'mine'),
  ('40000000-0000-4000-8000-00000000000c', NULL, 'owner-less');
INSERT INTO public.vave_ideas (project_id) VALUES ('40000000-0000-4000-8000-00000000000a'), ('40000000-0000-4000-8000-00000000000c');

-- the hole, before 942: a member of A sends B's RFQ by naming B's owner as the acting user
SET ROLE authenticated;
SET test.uid = 'a0000000-0000-4000-8000-0000000000a0'; SET test.org_ids = 'aaaaaaaa-0000-4000-8000-000000000001';
DO $$ BEGIN
  PERFORM public.send_rfq('20000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-0000000000b0');
END $$;
RESET ROLE;
UPDATE public.rfq_records SET status = 'draft';

\i /migrations/942_security_definer_review.sql
\i /migrations/942_security_definer_review.sql

DO $$
DECLARE f text;
BEGIN
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.send_rfq(uuid, uuid)'::regprocedure), 'send_rfq runs as the caller';
  ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_vendor_rating_matrix(uuid, uuid)'::regprocedure), 'so does the vendor rating matrix';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.freeze_evaluation(uuid, uuid)'::regprocedure), 'freezing stays DEFINER (checked)';
  ASSERT (SELECT proconfig FROM pg_proc WHERE oid = 'public.current_user_org_ids()'::regprocedure) = '{"search_path=public, pg_temp"}', 'current_user_org_ids has a pinned search_path';
  FOREACH f IN ARRAY ARRAY['public.send_rfq(uuid, uuid)', 'public.close_rfq(uuid, uuid)', 'public.freeze_evaluation(uuid, uuid)',
                           'public.get_vendor_rating_matrix(uuid, uuid)', 'public.add_organization_owner_membership(uuid)',
                           'public.invite_organization_member(uuid, text, text)', 'public.remove_organization_member(uuid, uuid)'] LOOP
    ASSERT NOT has_function_privilege('anon', f, 'EXECUTE'), format('anon cannot run %s', f);
    ASSERT has_function_privilege('authenticated', f, 'EXECUTE'), format('signed-in users still can run %s', f);
  END LOOP;
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.invite_organization_member(uuid, text, text)'::regprocedure), 'membership writes run as owner';
END $$;

-- A user of organization A
SET ROLE authenticated;
SET test.uid = 'a0000000-0000-4000-8000-0000000000a0'; SET test.org_ids = 'aaaaaaaa-0000-4000-8000-000000000001';
DO $$ BEGIN
  BEGIN
    PERFORM public.send_rfq('20000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-0000000000b0');
    RAISE EXCEPTION 'sent organization B''s RFQ';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.close_rfq('20000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-0000000000a0');
    RAISE EXCEPTION 'closed organization B''s RFQ';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.send_rfq('20000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000a0');
  ASSERT (SELECT status FROM public.rfq_records WHERE id = '20000000-0000-4000-8000-00000000000a') = 'sent', 'A sends its own RFQ';

  BEGIN
    PERFORM public.freeze_evaluation('30000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-0000000000b0');
    RAISE EXCEPTION 'froze B''s evaluation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.freeze_evaluation('30000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-0000000000a0');
    RAISE EXCEPTION 'froze B''s evaluation as itself';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.freeze_evaluation('30000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-0000000000b0');
    RAISE EXCEPTION 'recorded someone else as the approver';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT public.freeze_evaluation('30000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-0000000000a0') IS NOT NULL, 'A freezes its own evaluation';

  ASSERT (SELECT count(*) FROM public.vave_projects) = 1, 'only the own vave project is visible, not the owner-less one';
  ASSERT (SELECT count(*) FROM public.vave_ideas) = 1, 'and only its ideas';
  BEGIN
    INSERT INTO public.vave_projects (id, owner_id) VALUES (gen_random_uuid(), NULL);
    RAISE EXCEPTION 'created an owner-less vave project';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

DO $$ BEGIN
  ASSERT (SELECT status FROM public.rfq_records WHERE id = '20000000-0000-4000-8000-00000000000b') = 'draft', 'B''s RFQ is untouched';
  ASSERT (SELECT is_frozen FROM public.supplier_evaluation_records WHERE id = '30000000-0000-4000-8000-00000000000b') = false, 'B''s evaluation is untouched';
  ASSERT (SELECT approved_by FROM public.supplier_evaluation_records WHERE id = '30000000-0000-4000-8000-00000000000a') = 'a0000000-0000-4000-8000-0000000000a0', 'A approved its own';
END $$;

-- The backend's privileged client (service role, no user) still passes the checks
SET test.uid = ''; SET test.org_ids = ''; SET request.jwt.claims = '{"role":"service_role"}';
DO $$ BEGIN
  PERFORM public.close_rfq('20000000-0000-4000-8000-00000000000b', NULL);
  ASSERT (SELECT status FROM public.rfq_records WHERE id = '20000000-0000-4000-8000-00000000000b') = 'closed', 'the service role closes any RFQ';
END $$;
SET request.jwt.claims = '';

-- Memberships. Org A's owner records their owner membership of org C, never of someone else's organization.
SET ROLE authenticated;
SET test.uid = 'a0000000-0000-4000-8000-0000000000a0';
DO $$ BEGIN
  PERFORM public.add_organization_owner_membership('cccccccc-0000-4000-8000-000000000003');
  PERFORM public.add_organization_owner_membership('cccccccc-0000-4000-8000-000000000003');
  BEGIN
    PERFORM public.add_organization_owner_membership('bbbbbbbb-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'became owner of B';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- The admin of A invites; bad roles and empty emails are refused; B is not theirs.
SET test.uid = 'ad000000-0000-4000-8000-0000000000ad';
DO $$
DECLARE v uuid;
BEGIN
  v := public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', '  New@Example.COM ', 'member');
  ASSERT v IS NOT NULL, 'the invite returns the new row id';
  PERFORM set_config('test.invited', v::text, false);
  BEGIN
    PERFORM public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', 'x@example.com', 'owner');
    RAISE EXCEPTION 'invited an owner';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', '   ', 'viewer');
    RAISE EXCEPTION 'invited an empty email';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.invite_organization_member('bbbbbbbb-0000-4000-8000-000000000002', 'x@example.com', 'member');
    RAISE EXCEPTION 'invited into B';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.remove_organization_member('aaaaaaaa-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000a0');
    RAISE EXCEPTION 'removed the owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.remove_organization_member('aaaaaaaa-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000b0');
    RAISE EXCEPTION 'removed a row of B through A';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;

-- A plain member of A and the owner of B can neither invite into nor remove from A.
SET test.uid = 'ee000000-0000-4000-8000-0000000000ee';
DO $$ BEGIN
  BEGIN
    PERFORM public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', 'y@example.com', 'viewer');
    RAISE EXCEPTION 'a member invited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.remove_organization_member('aaaaaaaa-0000-4000-8000-000000000001', current_setting('test.invited')::uuid);
    RAISE EXCEPTION 'a member removed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET test.uid = 'b0000000-0000-4000-8000-0000000000b0';
DO $$ BEGIN
  BEGIN
    PERFORM public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', 'y@example.com', 'admin');
    RAISE EXCEPTION 'an outsider invited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.remove_organization_member('aaaaaaaa-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000ee');
    RAISE EXCEPTION 'an outsider removed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- The admin removes the invite; the owner removes the member.
SET test.uid = 'ad000000-0000-4000-8000-0000000000ad';
DO $$ BEGIN PERFORM public.remove_organization_member('aaaaaaaa-0000-4000-8000-000000000001', current_setting('test.invited')::uuid); END $$;
SET test.uid = 'a0000000-0000-4000-8000-0000000000a0';
DO $$ BEGIN PERFORM public.remove_organization_member('aaaaaaaa-0000-4000-8000-000000000001', '10000000-0000-4000-8000-0000000000ee'); END $$;
RESET ROLE;

DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.organization_members
           WHERE organization_id = 'cccccccc-0000-4000-8000-000000000003' AND user_id = 'a0000000-0000-4000-8000-0000000000a0'
             AND role = 'owner' AND status = 'active') = 1, 'one owner membership of C';
  ASSERT NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
                      AND user_id = 'a0000000-0000-4000-8000-0000000000a0'), 'none of B';
  ASSERT NOT EXISTS (SELECT 1 FROM public.organization_members WHERE invited_email IS NOT NULL AND invited_email <> 'new@example.com'), 'no refused invite landed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id = current_setting('test.invited')::uuid), 'the invite was removed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id = '10000000-0000-4000-8000-0000000000ee'), 'the member was removed';
  ASSERT (SELECT count(*) FROM public.organization_members WHERE organization_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 2, 'owner and admin remain';
  ASSERT EXISTS (SELECT 1 FROM public.organization_members WHERE id = '10000000-0000-4000-8000-0000000000b0'), 'B''s owner remains';
END $$;

-- An invite's stored shape (checked on a fresh one, as the owner of A)
SET ROLE authenticated;
SET test.uid = 'a0000000-0000-4000-8000-0000000000a0';
DO $$ BEGIN
  PERFORM set_config('test.invited', public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', ' Z@Example.com', 'viewer')::text, false);
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT row(invited_email::text, role, status, invited_by, user_id IS NULL) FROM public.organization_members WHERE id = current_setting('test.invited')::uuid)
         = row('z@example.com'::text, 'viewer'::text, 'invited'::text, 'a0000000-0000-4000-8000-0000000000a0'::uuid, true), 'invite stored trimmed, lowercased, invited, by the caller';
END $$;

-- anon is refused outright
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.invite_organization_member('aaaaaaaa-0000-4000-8000-000000000001', 'q@example.com', 'member');
    RAISE EXCEPTION 'anon invited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_vendor_rating_matrix(gen_random_uuid(), gen_random_uuid());
    RAISE EXCEPTION 'anon read a vendor rating matrix';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- RFQ numbers are unique within an organization, no longer across all of them
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rfq_records'::regclass AND conname = 'rfq_records_rfq_number_key'),
    'the global rfq_number uniqueness is gone';
  INSERT INTO public.rfq_records (id, organization_id, rfq_number) VALUES
    (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'RFQ-202611-001'),
    (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-000000000002', 'RFQ-202611-001');
  BEGIN
    INSERT INTO public.rfq_records (id, organization_id, rfq_number) VALUES (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', 'RFQ-202611-001');
    RAISE EXCEPTION 'a duplicate number within one organization was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

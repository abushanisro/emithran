-- ============================================================================
-- Migration 942: review of every SECURITY DEFINER function a signed-in user can call, and the membership writes 921 broke
-- ============================================================================
-- A SECURITY DEFINER function runs as its owner and skips row-level security, so any id a caller passes in must be checked in
-- the body. Inventory of the latest definition of each one in migrations/ and database/migrations/ (921 left authenticated with
-- EXECUTE on everything it could already run, including functions that only had the default PUBLIC grant):
--   SECURITY INVOKER (the caller's own row-level security allows everything they do; several trusted a caller-supplied p_user_id):
--     get_project_cost_analysis, update_bom_items_sort_order (006); get_processes_by_vendor (048); get_vendors_by_process,
--     get_vendors_by_process_fallback (051); create_evaluation_snapshot (042); update_vendor_rating_matrix_batch,
--     get_vendor_rating_matrix, calculate_vendor_rating_overall_scores (064, granted to anon; 306); get_vendor_rating_overall_scores
--     (legacy 095); calculate_part_wise_rankings (307); get_supplier_evaluation_group, get_supplier_evaluation_groups_by_project,
--     get_supplier_evaluation_group_detailed, get_supplier_evaluation_metrics (561); replace_active_process_cost_records (704/891,
--     already INVOKER; asserted).
--   SECURITY INVOKER, body rewritten: send_rfq, close_rfq (552) authorised on a caller-supplied p_user_id; now the RFQ must belong
--     to one of the caller's organizations (42501). p_user_id is kept for the callers and no longer trusted.
--   Checked DEFINER: freeze_evaluation (042) needs to write is_frozen past the update policy; now the record must be the caller's
--     and p_user_id must be the caller (42501). verify_rfq_tracking_deleted (059) answered for any organization's ids; now only for
--     the caller's organizations. electronics_container_ok (916) now answers only for one of the caller's organizations.
--   Revoked from every API role but the service role (global maintenance, no API caller): refresh_performance_views,
--     update_vendor_ratings (legacy 000); refresh_production_views, update_vendor_overall_ratings, analyze_production_performance
--     (legacy 001).
--   Kept DEFINER, search_path pinned (no input, they read only the caller's own rows): is_user_authorized (019),
--     current_user_team_project_ids, current_user_managed_team_project_ids (562), current_user_org_ids (541).
--   Left as is: trigger functions (020, 026, 561 log_evaluation_activity, 631, 936 generate_qc_certificate_number); review_pmi_record
--     (908, checks owner role in the item's organization); current_user_admin_org_ids (919) and my_sole_active_organization (935),
--     caller-scoped; 917-923, 931, 932, 935 authenticate_api_key: service role only; the 202/203 delivery functions were dropped (934).
-- A service-role caller (the backend's privileged client: no auth.uid()) passes the checks through auth.role() = 'service_role'.
-- Also: vave (312) treated rows without an owner as shared by every tenant; they are now visible to no API role. And the three
-- organization-membership functions the organizations module calls, since 921 removed membership writes from signed-in users.
-- Last, rfq_number becomes unique per organization, so RFQs are numbered by a count of the caller's own organization.
-- Everything is guarded by existence and idempotent; nothing is created where the object it secures does not exist.
-- ============================================================================

-- 1. SECURITY INVOKER: the caller's row-level security already decides what these may read and write ---------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('get_project_cost_analysis', 'update_bom_items_sort_order', 'get_processes_by_vendor', 'get_vendors_by_process',
                         'get_vendors_by_process_fallback', 'create_evaluation_snapshot', 'update_vendor_rating_matrix_batch',
                         'get_vendor_rating_matrix', 'calculate_vendor_rating_overall_scores', 'get_vendor_rating_overall_scores',
                         'calculate_part_wise_rankings', 'get_supplier_evaluation_group', 'get_supplier_evaluation_groups_by_project',
                         'get_supplier_evaluation_group_detailed', 'get_supplier_evaluation_metrics', 'replace_active_process_cost_records')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', f);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
  END LOOP;
END
$$;

-- 2. send_rfq / close_rfq: INVOKER, and the RFQ must be in one of the caller's organizations ------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.send_rfq(uuid, uuid)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.send_rfq(p_rfq_id uuid, p_user_id uuid) RETURNS void
      LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
      AS $body$
      BEGIN
        -- p_user_id is kept for the callers' signature; the acting user is auth.uid().
        IF NOT EXISTS (
          SELECT 1 FROM public.rfq_records rr
           WHERE rr.id = p_rfq_id
             AND (rr.organization_id IN (SELECT public.current_user_org_ids()) OR coalesce(auth.role(), '') = 'service_role')
        ) THEN
          RAISE EXCEPTION 'RFQ not found or unauthorized' USING ERRCODE = '42501';
        END IF;
        IF EXISTS (SELECT 1 FROM public.rfq_records WHERE id = p_rfq_id AND status != 'draft') THEN
          RAISE EXCEPTION 'RFQ already sent';
        END IF;
        UPDATE public.rfq_records SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = p_rfq_id;
      END
      $body$
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.send_rfq(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.send_rfq(uuid, uuid) TO authenticated, service_role;
  END IF;

  IF to_regprocedure('public.close_rfq(uuid, uuid)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.close_rfq(p_rfq_id uuid, p_user_id uuid) RETURNS void
      LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
      AS $body$
      BEGIN
        -- p_user_id is kept for the callers' signature; the acting user is auth.uid().
        IF NOT EXISTS (
          SELECT 1 FROM public.rfq_records rr
           WHERE rr.id = p_rfq_id
             AND (rr.organization_id IN (SELECT public.current_user_org_ids()) OR coalesce(auth.role(), '') = 'service_role')
        ) THEN
          RAISE EXCEPTION 'RFQ not found or unauthorized' USING ERRCODE = '42501';
        END IF;
        UPDATE public.rfq_records SET status = 'closed', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = p_rfq_id;
      END
      $body$
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.close_rfq(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.close_rfq(uuid, uuid) TO authenticated, service_role;
  END IF;
END
$$;

-- 3. Checked SECURITY DEFINER ------------------------------------------------------------------------------------------------
DO $$
BEGIN
  -- Freezing sets is_frozen, which the update policy of supplier_evaluation_records forbids, so it stays DEFINER. The record must
  -- be the caller's, and the approver written into it must be the caller. pgcrypto's digest() lives in `extensions` on Supabase.
  IF to_regprocedure('public.freeze_evaluation(uuid, uuid)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.freeze_evaluation(p_evaluation_id uuid, p_user_id uuid) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
      AS $body$
      DECLARE
        v_snapshot_id uuid;
        v_next_version integer;
        v_evaluation jsonb;
        v_hash text;
      BEGIN
        IF coalesce(auth.role(), '') <> 'service_role' AND (
             auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()
             OR NOT EXISTS (SELECT 1 FROM public.supplier_evaluation_records WHERE id = p_evaluation_id AND user_id = auth.uid())
           ) THEN
          RAISE EXCEPTION 'Evaluation not found or unauthorized' USING ERRCODE = '42501';
        END IF;

        IF EXISTS (SELECT 1 FROM public.supplier_evaluation_records WHERE id = p_evaluation_id AND is_frozen = true) THEN
          RAISE EXCEPTION 'Evaluation already frozen';
        END IF;

        SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
          FROM public.supplier_evaluation_snapshots WHERE evaluation_id = p_evaluation_id;
        SELECT to_jsonb(ser) INTO v_evaluation FROM public.supplier_evaluation_records ser WHERE id = p_evaluation_id;
        v_hash := encode(digest(v_evaluation::text, 'sha256'), 'hex');

        INSERT INTO public.supplier_evaluation_snapshots (evaluation_id, version, snapshot_payload, snapshot_hash, snapshot_reason, created_by)
        VALUES (p_evaluation_id, v_next_version, v_evaluation, v_hash, 'approval', p_user_id)
        RETURNING id INTO v_snapshot_id;

        UPDATE public.supplier_evaluation_records
           SET is_frozen = true, status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = p_user_id, updated_at = CURRENT_TIMESTAMP
         WHERE id = p_evaluation_id;

        RETURN v_snapshot_id;
      END
      $body$
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.freeze_evaluation(uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.freeze_evaluation(uuid, uuid) TO authenticated, service_role;
  END IF;

  -- Tells a caller whether a tracking row is really gone after a delete their row-level security may have filtered. It answers
  -- only for rows of the caller's organizations: another organization's row reads as "not there", as it does to every query.
  IF to_regprocedure('public.verify_rfq_tracking_deleted(uuid)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.verify_rfq_tracking_deleted(tracking_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
      AS $body$
        SELECT NOT EXISTS (
          SELECT 1 FROM public.rfq_tracking t
           WHERE t.id = tracking_id
             AND (t.organization_id IN (SELECT public.current_user_org_ids()) OR coalesce(auth.role(), '') = 'service_role')
        )
      $body$
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.verify_rfq_tracking_deleted(uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.verify_rfq_tracking_deleted(uuid) TO authenticated, service_role;
  END IF;

  -- Used by the electronics_designs insert policy, which already requires the organization to be the caller's; checked here too
  -- so a direct call cannot probe another organization's design ids.
  IF to_regprocedure('public.electronics_container_ok(uuid, uuid, uuid)') IS NOT NULL THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.electronics_container_ok(p_parent uuid, p_org uuid, p_project uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
      AS $body$
        SELECT p_parent IS NULL OR (
          p_org IN (SELECT public.current_user_org_ids())
          AND EXISTS (
            SELECT 1 FROM public.electronics_designs d
             WHERE d.id = p_parent AND d.organization_id = p_org AND d.item_type <> 'child_part'
               AND d.project_id IS NOT DISTINCT FROM p_project
          )
        )
      $body$
    $fn$;
    REVOKE EXECUTE ON FUNCTION public.electronics_container_ok(uuid, uuid, uuid) FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.electronics_container_ok(uuid, uuid, uuid) TO authenticated;
  END IF;
END
$$;

-- 4. Global maintenance functions: service role only --------------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('refresh_performance_views', 'update_vendor_ratings', 'refresh_production_views', 'update_vendor_overall_ratings',
                         'analyze_production_performance')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END
$$;

-- 5. Caller-scoped DEFINER helpers keep DEFINER; their search_path is pinned ---------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('is_user_authorized', 'current_user_team_project_ids', 'current_user_managed_team_project_ids', 'current_user_org_ids')
       AND p.pronargs = 0
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
  END LOOP;
END
$$;

-- 6. vave: a project without an owner was readable and writable by every signed-in user of every tenant ------------------------
DO $$
DECLARE t text;
BEGIN
  IF to_regclass('public.vave_projects') IS NULL THEN RETURN; END IF;
  DROP POLICY IF EXISTS vave_projects_select ON public.vave_projects;
  DROP POLICY IF EXISTS vave_projects_insert ON public.vave_projects;
  DROP POLICY IF EXISTS vave_projects_update ON public.vave_projects;
  DROP POLICY IF EXISTS vave_projects_delete ON public.vave_projects;
  CREATE POLICY vave_projects_select ON public.vave_projects FOR SELECT USING (owner_id = auth.uid());
  CREATE POLICY vave_projects_insert ON public.vave_projects FOR INSERT WITH CHECK (owner_id = auth.uid());
  CREATE POLICY vave_projects_update ON public.vave_projects FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  CREATE POLICY vave_projects_delete ON public.vave_projects FOR DELETE USING (owner_id = auth.uid());

  FOREACH t IN ARRAY ARRAY['vave_bom', 'vave_ideas', 'vave_should_costs'] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', t)) IS NULL;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public.vave_projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))'
      ' WITH CHECK (EXISTS (SELECT 1 FROM public.vave_projects p WHERE p.id = project_id AND p.owner_id = auth.uid()))', t || '_all', t);
  END LOOP;
END
$$;

-- 7. Organization membership writes, checked here because signed-in users may no longer write organization_members (921) -------
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'organizations' AND column_name IN ('id', 'owner_id'))
           OR (table_name = 'organization_members'
               AND column_name IN ('id', 'organization_id', 'user_id', 'role', 'status', 'invited_email', 'invited_by')))) < 9 THEN
    RETURN;
  END IF;

  -- The owner of a new organization records their own owner membership.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.add_organization_owner_membership(p_organization_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $body$
    BEGIN
      IF auth.uid() IS NULL
         OR NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id AND o.owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'not the owner of this organization' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES (p_organization_id, auth.uid(), 'owner', 'active')
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    END
    $body$
  $fn$;

  -- An active owner or admin (or the organization's owner) invites someone by email as an admin, member or viewer.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.invite_organization_member(p_organization_id uuid, p_email text, p_role text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $body$
    DECLARE
      v_email text := lower(btrim(coalesce(p_email, '')));
      v_id uuid;
    BEGIN
      IF auth.uid() IS NULL OR NOT (
           EXISTS (SELECT 1 FROM public.organization_members m
                    WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
                      AND m.status = 'active' AND m.role IN ('owner', 'admin'))
           OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id AND o.owner_id = auth.uid())
         ) THEN
        RAISE EXCEPTION 'not an owner or admin of this organization' USING ERRCODE = '42501';
      END IF;
      IF p_role IS NULL OR p_role NOT IN ('admin', 'member', 'viewer') THEN
        RAISE EXCEPTION 'role must be admin, member or viewer' USING ERRCODE = '22023';
      END IF;
      IF v_email = '' THEN
        RAISE EXCEPTION 'email is required' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.organization_members (organization_id, invited_email, role, status, invited_by)
      VALUES (p_organization_id, v_email, p_role, 'invited', auth.uid())
      RETURNING id INTO v_id;
      RETURN v_id;
    END
    $body$
  $fn$;

  -- An active owner or admin removes a membership row of their organization; the owner's row cannot be removed.
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.remove_organization_member(p_organization_id uuid, p_member_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
    AS $body$
    DECLARE v_role text;
    BEGIN
      IF auth.uid() IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.organization_members m
            WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
              AND m.status = 'active' AND m.role IN ('owner', 'admin')
         ) THEN
        RAISE EXCEPTION 'not an owner or admin of this organization' USING ERRCODE = '42501';
      END IF;
      SELECT m.role INTO v_role FROM public.organization_members m
       WHERE m.id = p_member_id AND m.organization_id = p_organization_id
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002';
      END IF;
      IF v_role = 'owner' THEN
        RAISE EXCEPTION 'the owner cannot be removed' USING ERRCODE = '42501';
      END IF;
      DELETE FROM public.organization_members WHERE id = p_member_id AND organization_id = p_organization_id;
    END
    $body$
  $fn$;

  REVOKE ALL ON FUNCTION public.add_organization_owner_membership(uuid), public.invite_organization_member(uuid, text, text),
    public.remove_organization_member(uuid, uuid) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.add_organization_owner_membership(uuid), public.invite_organization_member(uuid, text, text),
    public.remove_organization_member(uuid, uuid) TO authenticated, service_role;
END
$$;

-- RFQ numbers count per organization -------------------------------------------------------------------------------------------
-- rfq_number was UNIQUE across every organization (043), so the backend counted the whole table with the service role to number a
-- new RFQ, which handed every tenant the platform-wide monthly RFQ count. Numbers are now unique within an organization (RFQs
-- without one are numbered among themselves), and the backend counts the caller's organization's RFQs as the caller.
DO $$
DECLARE c record;
BEGIN
  IF to_regclass('public.rfq_records') IS NULL THEN RETURN; END IF;
  FOR c IN SELECT con.conname FROM pg_constraint con
            WHERE con.conrelid = 'public.rfq_records'::regclass AND con.contype = 'u'
              AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.rfq_records'::regclass AND attname = 'rfq_number')]
  LOOP
    EXECUTE format('ALTER TABLE public.rfq_records DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.rfq_records'::regclass AND conname = 'rfq_records_organization_rfq_number_key') THEN
    ALTER TABLE public.rfq_records
      ADD CONSTRAINT rfq_records_organization_rfq_number_key UNIQUE NULLS NOT DISTINCT (organization_id, rfq_number);
  END IF;
END
$$;

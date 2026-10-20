-- ============================================================================
-- Migration 916: fix the infinite recursion in the electronics_designs insert policy (915)
-- ============================================================================
-- Migration 915 checked the container of a new design with a subquery on electronics_designs inside the insert policy of
-- electronics_designs itself. Postgres refuses that ("infinite recursion detected in policy"), so every insert failed.
--
-- The container check moves into a SECURITY DEFINER function, which reads the container without applying the policies of the
-- table again. It answers only yes or no, and only for a container of the organization named in the new row, which the policy
-- already requires to be one of the caller organizations.
-- Idempotent. One DO block.
-- ============================================================================

DO $$
BEGIN
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.electronics_container_ok(p_parent uuid, p_org uuid, p_project uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $body$
      SELECT p_parent IS NULL OR EXISTS (
        SELECT 1 FROM public.electronics_designs d
        WHERE d.id = p_parent
          AND d.organization_id = p_org
          AND d.item_type <> 'child_part'
          AND d.project_id IS NOT DISTINCT FROM p_project
      )
    $body$
  $fn$;

  REVOKE ALL ON FUNCTION public.electronics_container_ok(uuid, uuid, uuid) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.electronics_container_ok(uuid, uuid, uuid) TO authenticated;

  DROP POLICY IF EXISTS org_insert_electronics_designs ON public.electronics_designs;
  CREATE POLICY org_insert_electronics_designs ON public.electronics_designs FOR INSERT
    WITH CHECK (
      organization_id IN (SELECT current_user_org_ids())
      AND created_by = auth.uid()
      AND (
        project_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = electronics_designs.project_id
            AND p.organization_id = electronics_designs.organization_id
        )
      )
      AND public.electronics_container_ok(parent_design_id, organization_id, project_id)
    );
END $$;

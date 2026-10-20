-- ============================================================================
-- Migration 914: link electronics designs to projects
-- ============================================================================
-- A board or harness design can belong to one project, the same way a BOM does, so the Electronics
-- workspace opens from the project page. The link is optional (designs created before this, and the
-- quick-upload page, have none) and is set when the design is created; designs are not updated by
-- end users, so there is no UPDATE policy.
--
-- The insert policy now also requires the project, when given, to be in the same organization, so a
-- design cannot be attached to another organization project by guessing its id.
-- Idempotent.
-- ============================================================================

ALTER TABLE public.electronics_designs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS electronics_designs_project
  ON public.electronics_designs (project_id, created_at DESC) WHERE project_id IS NOT NULL;

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
  );

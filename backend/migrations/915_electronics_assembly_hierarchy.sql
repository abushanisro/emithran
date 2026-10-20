-- ============================================================================
-- Migration 915: assemblies, sub-assemblies and child parts for electronics designs
-- ============================================================================
-- An uploaded folder becomes a tree the way a BOM does: Assembly > Sub-Assembly > Child Part. A child part is a board or a
-- wire harness (it has revisions and files, as before). An assembly or sub-assembly is a container: it has no files of its own,
-- only children, and its kind is 'assembly'.
--
--   parent_design_id  the container a design sits in (NULL for a top-level item)
--   item_type         assembly | sub_assembly | child_part (child_part for everything created before this migration)
--
-- A container always has kind 'assembly' and a child part never does, so the two columns cannot disagree.
-- A design can only be placed under a container of the same organization and the same project (insert policy).
-- Idempotent. One DO block: it also removes the old kind check, whichever name it was given.
-- ============================================================================

DO $$
DECLARE
  old_check text;
BEGIN
  ALTER TABLE public.electronics_designs
    ADD COLUMN IF NOT EXISTS parent_design_id uuid REFERENCES public.electronics_designs(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'child_part';

  FOR old_check IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.electronics_designs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%'
      AND pg_get_constraintdef(oid) NOT LIKE '%item_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.electronics_designs DROP CONSTRAINT %I', old_check);
  END LOOP;

  ALTER TABLE public.electronics_designs DROP CONSTRAINT IF EXISTS electronics_designs_item_type_check;
  ALTER TABLE public.electronics_designs ADD CONSTRAINT electronics_designs_item_type_check
    CHECK (item_type IN ('assembly', 'sub_assembly', 'child_part'));

  ALTER TABLE public.electronics_designs DROP CONSTRAINT IF EXISTS electronics_designs_kind_item_type_check;
  ALTER TABLE public.electronics_designs ADD CONSTRAINT electronics_designs_kind_item_type_check
    CHECK (kind IN ('board', 'harness', 'assembly') AND ((item_type = 'child_part') = (kind <> 'assembly')));

  CREATE INDEX IF NOT EXISTS electronics_designs_parent
    ON public.electronics_designs (parent_design_id, created_at) WHERE parent_design_id IS NOT NULL;

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
      AND (
        parent_design_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.electronics_designs d
          WHERE d.id = electronics_designs.parent_design_id
            AND d.organization_id = electronics_designs.organization_id
            AND d.item_type <> 'child_part'
            AND d.project_id IS NOT DISTINCT FROM electronics_designs.project_id
        )
      )
    );
END $$;

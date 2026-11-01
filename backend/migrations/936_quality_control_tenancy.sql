-- ============================================================================
-- Migration 936: organization isolation for the quality-control tables.
--
-- Until now the backend read and wrote these tables with the privileged client and no tenancy filter, so any signed-in user
-- could list, read, update and delete every customer's inspections. This migration gives every row an owning organization and
-- lets row-level security limit each caller to the organizations they are an active member of (current_user_org_ids(),
-- migration 541); the backend then uses the caller's own client.
--
--   quality_inspections                      organization of its project (projects.organization_id)
--   quality_inspection_results,
--   quality_non_conformances,
--   detailed_inspection_reports              organization of their inspection (inspection_id)
--   quality_approved_items                   organization of its BOM item (bom_items.organization_id)
--
-- A row whose organization cannot be worked out keeps organization_id NULL and is visible to nobody (fail closed); an operator
-- can attribute it with the service role. quality_inspections, quality_inspection_results and quality_non_conformances were
-- created outside the numbered migrations, so every step only runs when its table exists, and only columns the backend already
-- reads or writes (id, project_id, inspection_id, bom_item_id) are relied on. quality_plans is not touched: it holds sampling
-- policies (system rows readable by all, user rows by owner_id, migration 335), not per-project data.
--
-- Every existing policy on these tables is dropped first: permissive policies are OR-ed together, so any older, wider policy
-- left in place would undo the isolation.
--
-- Idempotent.
-- ============================================================================

DO $$
DECLARE
  t text;
  pol record;
  in_my_orgs text := 'organization_id IN (SELECT public.current_user_org_ids())';
  parent_matches text;
BEGIN
  -- ── Column, index, grants ──────────────────────────────────────────────────
  FOREACH t IN ARRAY ARRAY['quality_inspections', 'quality_inspection_results', 'quality_non_conformances',
                           'detailed_inspection_reports', 'quality_approved_items'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (organization_id)', 'idx_' || t || '_organization_id', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;

  -- ── Inspections: owned by the organization of their project ────────────────
  IF to_regclass('public.quality_inspections') IS NOT NULL THEN
    UPDATE public.quality_inspections qi
       SET organization_id = p.organization_id
      FROM public.projects p
     WHERE p.id = qi.project_id AND qi.organization_id IS NULL AND p.organization_id IS NOT NULL;

    -- A new or changed inspection belongs to one of the caller's organizations, and its project (if any) to the same one.
    CREATE POLICY qc_org_select ON public.quality_inspections FOR SELECT
      USING (organization_id IN (SELECT public.current_user_org_ids()));
    CREATE POLICY qc_org_insert ON public.quality_inspections FOR INSERT
      WITH CHECK (
        organization_id IN (SELECT public.current_user_org_ids())
        AND (project_id IS NULL OR EXISTS (
          SELECT 1 FROM public.projects p
           WHERE p.id = quality_inspections.project_id AND p.organization_id = quality_inspections.organization_id))
      );
    CREATE POLICY qc_org_update ON public.quality_inspections FOR UPDATE
      USING (organization_id IN (SELECT public.current_user_org_ids()))
      WITH CHECK (
        organization_id IN (SELECT public.current_user_org_ids())
        AND (project_id IS NULL OR EXISTS (
          SELECT 1 FROM public.projects p
           WHERE p.id = quality_inspections.project_id AND p.organization_id = quality_inspections.organization_id))
      );
    CREATE POLICY qc_org_delete ON public.quality_inspections FOR DELETE
      USING (organization_id IN (SELECT public.current_user_org_ids()));
  END IF;

  -- ── Rows that hang off an inspection: owned by the inspection's organization ─
  IF to_regclass('public.quality_inspections') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['quality_inspection_results', 'quality_non_conformances', 'detailed_inspection_reports'] LOOP
      CONTINUE WHEN to_regclass('public.' || t) IS NULL;
      EXECUTE format(
        'UPDATE public.%I c SET organization_id = qi.organization_id FROM public.quality_inspections qi
          WHERE qi.id = c.inspection_id AND c.organization_id IS NULL AND qi.organization_id IS NOT NULL', t);
      parent_matches := format(
        'EXISTS (SELECT 1 FROM public.quality_inspections qi WHERE qi.id = %1$I.inspection_id AND qi.organization_id = %1$I.organization_id)', t);
      EXECUTE format('CREATE POLICY qc_org_select ON public.%I FOR SELECT USING (%s)', t, in_my_orgs);
      EXECUTE format('CREATE POLICY qc_org_insert ON public.%I FOR INSERT WITH CHECK (%s AND %s)', t, in_my_orgs, parent_matches);
      EXECUTE format('CREATE POLICY qc_org_update ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s AND %s)',
                     t, in_my_orgs, in_my_orgs, parent_matches);
      EXECUTE format('CREATE POLICY qc_org_delete ON public.%I FOR DELETE USING (%s)', t, in_my_orgs);
    END LOOP;
  END IF;

  -- ── Approved items: owned by the organization of their BOM item ────────────
  IF to_regclass('public.quality_approved_items') IS NOT NULL THEN
    UPDATE public.quality_approved_items qai
       SET organization_id = bi.organization_id
      FROM public.bom_items bi
     WHERE bi.id = qai.bom_item_id AND qai.organization_id IS NULL AND bi.organization_id IS NOT NULL;

    t := 'quality_approved_items';
    EXECUTE format('CREATE POLICY qc_org_select ON public.%I FOR SELECT USING (%s)', t, in_my_orgs);
    EXECUTE format('CREATE POLICY qc_org_insert ON public.%I FOR INSERT WITH CHECK (%s)', t, in_my_orgs);
    EXECUTE format('CREATE POLICY qc_org_update ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)', t, in_my_orgs, in_my_orgs);
    EXECUTE format('CREATE POLICY qc_org_delete ON public.%I FOR DELETE USING (%s)', t, in_my_orgs);
  END IF;

  -- The certificate-number trigger of migration 201 numbers certificates per project-name prefix against a UNIQUE column. Under
  -- row-level security it would only count the caller's own rows and could hand out a number another organization already holds,
  -- so it keeps counting every row, as it did when the backend wrote with the privileged client. It returns only the new number.
  IF to_regprocedure('public.generate_qc_certificate_number()') IS NOT NULL THEN
    ALTER FUNCTION public.generate_qc_certificate_number() SECURITY DEFINER SET search_path = public, pg_temp;
  END IF;
END $$;

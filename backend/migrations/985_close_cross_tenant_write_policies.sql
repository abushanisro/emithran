-- ============================================================================
-- Migration 985: a signed-in user can no longer write rows INTO another organization
-- ============================================================================
-- Found by backend/test/tenant-isolation (the real schema, two organizations, one attacking the other). Permissive policies are OR-ed, so a legacy rule
-- that only says "you own the row" defeats the stricter organization rule beside it. Six attacks worked, each by a user of ANOTHER organization:
--   projects, boms            "Users can insert their own ..." checks only auth.uid() = user_id: a project or BOM could be stamped with any organization_id
--                             and then appeared in that organization's workspace.
--   rfq_email_logs            INSERT and UPDATE were WITH CHECK / USING (true): anyone could add to or edit anyone's email delivery records.
--   machining_rule_results    INSERT was WITH CHECK (true): anyone could inject manufacturing results into anyone's part.
--   process_planning_specifications   WITH CHECK (true), and rows with no owner were editable by everyone: anyone could inject a specification into
--                             anyone's part, and an injected row occupies the one-per-(part, project) slot so the real owner could no longer save theirs.
-- The backend writes all of these with the CALLER's token, so row-level security is what protects them; the service role (background jobs) bypasses it.
-- The three weak tables hold no rows, so nothing legacy is stranded. Every rule below is the narrowest one the existing legitimate flows need:
--   * a caller may write only for rows they own or can already SEE (a sub-select on a table is itself filtered by the caller's policies).
-- Every statement is guarded, so it is safe on a database where a table or a policy does not exist.
-- ============================================================================

DO $m985$
BEGIN
  -- projects: the legacy owner rules gain the organization condition (a NULL organization stays allowed: legacy personal projects)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'Users can insert their own projects') THEN
    ALTER POLICY "Users can insert their own projects" ON public.projects
      WITH CHECK (auth.uid() = user_id AND (organization_id IS NULL OR organization_id IN (SELECT public.current_user_org_ids())));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'Users can update their own projects') THEN
    ALTER POLICY "Users can update their own projects" ON public.projects
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id AND (organization_id IS NULL OR organization_id IN (SELECT public.current_user_org_ids())));
  END IF;

  -- boms: same, and the project a BOM hangs under must be one the caller can see
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boms' AND policyname = 'Users can insert their own boms') THEN
    ALTER POLICY "Users can insert their own boms" ON public.boms
      WITH CHECK (auth.uid() = user_id
        AND (organization_id IS NULL OR organization_id IN (SELECT public.current_user_org_ids()))
        AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = boms.project_id)));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'boms' AND policyname = 'Users can update their own boms') THEN
    ALTER POLICY "Users can update their own boms" ON public.boms
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id
        AND (organization_id IS NULL OR organization_id IN (SELECT public.current_user_org_ids()))
        AND (project_id IS NULL OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = boms.project_id)));
  END IF;
END
$m985$;

-- rfq_email_logs: only for RFQs the caller owns (the same rule that already limits who can read them)
DO $m985$
BEGIN
  IF to_regclass('public.rfq_email_logs') IS NOT NULL AND to_regclass('public.rfq_records') IS NOT NULL THEN
    DROP POLICY IF EXISTS "System can insert email logs" ON public.rfq_email_logs;
    DROP POLICY IF EXISTS "System can update email logs" ON public.rfq_email_logs;
    DROP POLICY IF EXISTS "Users can log emails for their own RFQs" ON public.rfq_email_logs;
    DROP POLICY IF EXISTS "Users can update logs of their own RFQs" ON public.rfq_email_logs;
    CREATE POLICY "Users can log emails for their own RFQs" ON public.rfq_email_logs FOR INSERT
      WITH CHECK (rfq_id IN (SELECT r.id FROM public.rfq_records r WHERE r.user_id = auth.uid()));
    CREATE POLICY "Users can update logs of their own RFQs" ON public.rfq_email_logs FOR UPDATE
      USING (rfq_id IN (SELECT r.id FROM public.rfq_records r WHERE r.user_id = auth.uid()))
      WITH CHECK (rfq_id IN (SELECT r.id FROM public.rfq_records r WHERE r.user_id = auth.uid()));
  END IF;
END
$m985$;

-- machining_rule_results: only for parts the caller can see
DO $m985$
BEGIN
  IF to_regclass('public.machining_rule_results') IS NOT NULL AND to_regclass('public.bom_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can insert their machining results" ON public.machining_rule_results;
    CREATE POLICY "Users can insert their machining results" ON public.machining_rule_results FOR INSERT
      WITH CHECK (bom_item_id IN (SELECT bi.id FROM public.bom_items bi));
  END IF;
END
$m985$;

-- process_planning_specifications: readable for parts the caller can see; written only under the caller's own name and only for such parts
-- (the catch-all "ALL ... OR created_by IS NULL ... WITH CHECK (true)" is replaced by one rule per command)
DO $m985$
BEGIN
  IF to_regclass('public.process_planning_specifications') IS NOT NULL AND to_regclass('public.bom_items') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Users can manage process planning specs" ON public.process_planning_specifications;
    DROP POLICY IF EXISTS "specs select visible parts" ON public.process_planning_specifications;
    DROP POLICY IF EXISTS "specs insert own for visible parts" ON public.process_planning_specifications;
    DROP POLICY IF EXISTS "specs update own" ON public.process_planning_specifications;
    DROP POLICY IF EXISTS "specs delete own" ON public.process_planning_specifications;
    CREATE POLICY "specs select visible parts" ON public.process_planning_specifications FOR SELECT TO authenticated
      USING (bom_item_id IN (SELECT bi.id FROM public.bom_items bi));
    CREATE POLICY "specs insert own for visible parts" ON public.process_planning_specifications FOR INSERT TO authenticated
      WITH CHECK (created_by = auth.uid() AND bom_item_id IN (SELECT bi.id FROM public.bom_items bi));
    CREATE POLICY "specs update own" ON public.process_planning_specifications FOR UPDATE TO authenticated
      USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid() AND bom_item_id IN (SELECT bi.id FROM public.bom_items bi));
    CREATE POLICY "specs delete own" ON public.process_planning_specifications FOR DELETE TO authenticated
      USING (created_by = auth.uid());
  END IF;
END
$m985$;

NOTIFY pgrst, 'reload schema';

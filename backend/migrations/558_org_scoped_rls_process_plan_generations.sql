-- ============================================================================
-- Migration 558: Org-scoped RLS for process_plan_generations + process_plan_line_edits
--
-- Phase 5 RLS step (see .claude/plans/delegated-gliding-swan.md). No
-- is_user_authorized() on either table originally (migration 148) — not
-- added now. process_plan_line_edits deliberately has only SELECT+INSERT
-- policies today (append-only audit trail / offline-eval dataset, per its
-- own migration comment) — no UPDATE/DELETE policy existed before, none
-- added now.
-- ============================================================================

DROP POLICY IF EXISTS "Users can view own generations" ON process_plan_generations;
DROP POLICY IF EXISTS "Users can insert own generations" ON process_plan_generations;
DROP POLICY IF EXISTS "Users can update own generations" ON process_plan_generations;
DROP POLICY IF EXISTS "Users can delete own generations" ON process_plan_generations;

CREATE POLICY "org_select_process_plan_generations" ON process_plan_generations FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_process_plan_generations" ON process_plan_generations FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_process_plan_generations" ON process_plan_generations FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_process_plan_generations" ON process_plan_generations FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

DROP POLICY IF EXISTS "Users can view own line edits" ON process_plan_line_edits;
DROP POLICY IF EXISTS "Users can insert own line edits" ON process_plan_line_edits;

CREATE POLICY "org_select_process_plan_line_edits" ON process_plan_line_edits FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_process_plan_line_edits" ON process_plan_line_edits FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

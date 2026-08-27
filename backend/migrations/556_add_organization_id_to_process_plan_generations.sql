-- ============================================================================
-- Migration 556: Add organization_id to process_plan_generations + process_plan_line_edits
--
-- Phase 5 of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md). Audited first (forked subagent):
-- this pair is a clean, self-contained conversion — one insert path
-- (orchestrator.service.ts's insertGenerationRow / persistence.service.ts's
-- recordLineEdit), no policy erosion (only migration 148 ever touches these
-- tables' RLS, confirmed via git log across all three migration
-- directories), no dormant organization_id column, no SECURITY DEFINER
-- bypass to fix.
-- ============================================================================

ALTER TABLE process_plan_generations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE process_plan_line_edits  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_process_plan_generations_organization_id ON process_plan_generations(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_plan_line_edits_organization_id  ON process_plan_line_edits(organization_id)  WHERE organization_id IS NOT NULL;

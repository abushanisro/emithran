-- ============================================================================
-- Migration 553: Add the missing FK to projects.organization_id
--
-- Phase 4 of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md) — projects. Like boms before it
-- (migration 542), projects already has a dormant, FK-less organization_id
-- column from migrations/001_initial_schema.sql, added years ago and never
-- wired to RLS or application code. Only the FK is new here, using the same
-- idempotent check-then-add pattern as database/migrations/126 and
-- migration 542.
--
-- project_team_members does NOT get its own organization_id column —
-- unlike bom_items/rfq_tracking_vendors, it's small (3 live rows), never
-- queried independently of its parent project, and its own RLS already
-- derives visibility via an EXISTS join to projects — updated in migration
-- 555 to check projects.organization_id through that same join rather than
-- duplicating the column.
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'projects_organization_id_fkey'
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_organization_id_fkey
            FOREIGN KEY (organization_id) REFERENCES organizations(id);
    END IF;
END $$;

-- No new index: migrations/001_initial_schema.sql already created
-- idx_projects_organization_id (same partial-index shape) alongside the
-- dormant column back when it was first added.

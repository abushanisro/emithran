-- ============================================================================
-- Migration 542: Add organization_id to mhr_records, boms, bom_items
--
-- Phase 2 schema step of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md). Nullable, no default — backfilled
-- explicitly in migration 543, not silently defaulted here.
--
-- IMPORTANT: boms already has an organization_id UUID column and a partial
-- index (idx_boms_organization_id) from migrations/001_initial_schema.sql —
-- added back then, never wired to RLS or application code, and critically
-- never given a foreign key. This migration does NOT re-add the column
-- (ADD COLUMN IF NOT EXISTS would silently no-op anyway) — it only adds the
-- FK that column was always missing, using the same idempotent
-- check-then-add pattern already established in
-- database/migrations/126_fix_all_missing_tables.sql for api_keys'
-- organization_id/workspace_id FKs. mhr_records and bom_items have no such
-- dormant column, so those get a normal ADD COLUMN + partial index.
-- ============================================================================

ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_mhr_records_organization_id ON mhr_records(organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_bom_items_organization_id ON bom_items(organization_id) WHERE organization_id IS NOT NULL;

-- boms: column + index already exist (see note above) — only the FK is new.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'boms_organization_id_fkey'
    ) THEN
        ALTER TABLE boms
            ADD CONSTRAINT boms_organization_id_fkey
            FOREIGN KEY (organization_id) REFERENCES organizations(id);
    END IF;
END $$;

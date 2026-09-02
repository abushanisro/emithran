-- ============================================================================
-- Migration 625: Global-default-with-org-override RLS for the Process
-- cluster — process_calculator_mappings, process_taxonomy,
-- process_taxonomy_operations, process_taxonomy_aliases,
-- process_taxonomy_lookup_tables
--
-- Phase 7d (final sub-phase) of the master-data org-scoping initiative (see
-- .claude/plans/vivid-conjuring-reef.md). Same shape as migration 621
-- (raw_materials), for the same reason: this is a platform-wide process
-- taxonomy/catalog — 270 process_calculator_mappings rows and the full
-- process_taxonomy tree this session already spent significant effort
-- reconciling (Laser Punch/Laser Puch dedup, migration 609/610) — not
-- per-customer data. process_calculator_mappings' own migration
-- (319_fix_process_mappings_rls.sql) explicitly documented it as "a
-- shared/global master table (no owner_id column)" holding both
-- system-seeded rows AND user-approved proposed masters from AI plan
-- generation — org-scoping it outright would fragment that catalog and
-- require every org to rebuild it from scratch, exactly the raw_materials
-- risk already avoided in migration 621.
--
-- Existing rows (all 5 tables) stay organization_id IS NULL — globally
-- visible to every org, unchanged from today. An org can additionally
-- INSERT its own rows (e.g. approving an AI-proposed process master specific
-- to their own plans — see process-plan-generator/services/persistence.
-- service.ts's apply()) without those becoming visible to other orgs.
-- UPDATE is restricted to the owning org's own rows — this is also a real
-- fix: today ANY authenticated user can edit ANY row in the shared 270-row
-- catalog (migration 319's fully-open UPDATE policy); after this migration
-- the shared catalog itself is protected, editable only by however it's
-- seeded (service-role / a future admin path) or by the org that created a
-- given row.
--
-- No DELETE policy existed on any of these 5 tables before this migration
-- (checked directly — migration 319 defines only SELECT/INSERT/UPDATE;
-- migration 609 the same for its 4 tables) — that stays exactly as it was;
-- this migration does not add DELETE capability that wasn't already there.
-- ============================================================================

-- ── Schema: add organization_id to all 5 tables ─────────────────────────────

ALTER TABLE process_calculator_mappings      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE process_taxonomy                 ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE process_taxonomy_operations      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE process_taxonomy_aliases         ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE process_taxonomy_lookup_tables   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_process_calculator_mappings_organization_id ON process_calculator_mappings(organization_id);
CREATE INDEX IF NOT EXISTS idx_process_taxonomy_organization_id            ON process_taxonomy(organization_id);
CREATE INDEX IF NOT EXISTS idx_pt_operations_organization_id               ON process_taxonomy_operations(organization_id);
CREATE INDEX IF NOT EXISTS idx_pt_aliases_organization_id                  ON process_taxonomy_aliases(organization_id);
CREATE INDEX IF NOT EXISTS idx_pt_lookup_tables_organization_id            ON process_taxonomy_lookup_tables(organization_id);

-- ── RLS: process_calculator_mappings ────────────────────────────────────────

DROP POLICY IF EXISTS "process_mappings_select" ON process_calculator_mappings;
DROP POLICY IF EXISTS "process_mappings_insert" ON process_calculator_mappings;
DROP POLICY IF EXISTS "process_mappings_update" ON process_calculator_mappings;

CREATE POLICY "org_select_process_calculator_mappings" ON process_calculator_mappings FOR SELECT
    TO authenticated
    USING (organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_process_calculator_mappings" ON process_calculator_mappings FOR INSERT
    TO authenticated
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_process_calculator_mappings" ON process_calculator_mappings FOR UPDATE
    TO authenticated
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

-- ── RLS: process_taxonomy ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "process_taxonomy_select" ON process_taxonomy;
DROP POLICY IF EXISTS "process_taxonomy_insert" ON process_taxonomy;
DROP POLICY IF EXISTS "process_taxonomy_update" ON process_taxonomy;

CREATE POLICY "org_select_process_taxonomy" ON process_taxonomy FOR SELECT
    TO authenticated
    USING (organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_process_taxonomy" ON process_taxonomy FOR INSERT
    TO authenticated
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_process_taxonomy" ON process_taxonomy FOR UPDATE
    TO authenticated
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

-- ── RLS: process_taxonomy_operations ─────────────────────────────────────────

DROP POLICY IF EXISTS "pt_operations_select" ON process_taxonomy_operations;
DROP POLICY IF EXISTS "pt_operations_insert" ON process_taxonomy_operations;
DROP POLICY IF EXISTS "pt_operations_update" ON process_taxonomy_operations;

CREATE POLICY "org_select_pt_operations" ON process_taxonomy_operations FOR SELECT
    TO authenticated
    USING (organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_pt_operations" ON process_taxonomy_operations FOR INSERT
    TO authenticated
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_pt_operations" ON process_taxonomy_operations FOR UPDATE
    TO authenticated
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

-- ── RLS: process_taxonomy_aliases ────────────────────────────────────────────

DROP POLICY IF EXISTS "pt_aliases_select" ON process_taxonomy_aliases;
DROP POLICY IF EXISTS "pt_aliases_insert" ON process_taxonomy_aliases;
DROP POLICY IF EXISTS "pt_aliases_update" ON process_taxonomy_aliases;

CREATE POLICY "org_select_pt_aliases" ON process_taxonomy_aliases FOR SELECT
    TO authenticated
    USING (organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_pt_aliases" ON process_taxonomy_aliases FOR INSERT
    TO authenticated
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_pt_aliases" ON process_taxonomy_aliases FOR UPDATE
    TO authenticated
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

-- ── RLS: process_taxonomy_lookup_tables ──────────────────────────────────────

DROP POLICY IF EXISTS "pt_lookup_tables_select" ON process_taxonomy_lookup_tables;
DROP POLICY IF EXISTS "pt_lookup_tables_insert" ON process_taxonomy_lookup_tables;
DROP POLICY IF EXISTS "pt_lookup_tables_update" ON process_taxonomy_lookup_tables;

CREATE POLICY "org_select_pt_lookup_tables" ON process_taxonomy_lookup_tables FOR SELECT
    TO authenticated
    USING (organization_id IS NULL OR organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_pt_lookup_tables" ON process_taxonomy_lookup_tables FOR INSERT
    TO authenticated
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_pt_lookup_tables" ON process_taxonomy_lookup_tables FOR UPDATE
    TO authenticated
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

NOTIFY pgrst, 'reload schema';

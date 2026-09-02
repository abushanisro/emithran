-- ============================================================================
-- Migration 621: Global-default-with-org-override RLS for raw_materials
--
-- Phase 7b of the master-data org-scoping initiative (see
-- .claude/plans/vivid-conjuring-reef.md). Different shape from migration 620
-- (vendors) on purpose: raw_materials is a licensed, 574-row reference
-- catalog shared platform-wide (migration 349 made it fully open on
-- purpose — "Make raw_materials a global shared library"), not per-customer
-- business data. Converting it to pure org isolation like vendors would mean
-- every organization except the one that already has data sees ZERO
-- materials, breaking costing outright for any new org.
--
-- Design instead: existing rows stay organization_id IS NULL (globally
-- visible to every org, exactly as today) — nothing is backfilled. Any org
-- can additionally INSERT its own rows (organization_id = that org, never
-- NULL — new "global" rows can only be seeded by a service-role migration,
-- same mechanism calculators' system rows already use). UPDATE/DELETE are
-- restricted to the owning org's own rows — this is also a real fix: today,
-- migration 349's fully-open policy lets ANY authenticated user edit or
-- delete rows from the entire shared 574-row catalog; after this migration
-- the global catalog itself is read-only to everyone except however it gets
-- seeded (service-role / a future admin path), and an org can only ever
-- mutate rows it created itself.
--
-- raw_materials.organization_id already exists (nullable, no FK — migration
-- 069's original CREATE TABLE) — no ALTER ADD COLUMN needed, only a missing
-- FK constraint and index.
-- ============================================================================

-- ── Add the missing FK constraint (column itself already exists) ───────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_organization_id_fkey'
    ) THEN
        ALTER TABLE raw_materials
            ADD CONSTRAINT raw_materials_organization_id_fkey
            FOREIGN KEY (organization_id) REFERENCES organizations(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_raw_materials_organization_id ON raw_materials(organization_id);

-- ── RLS: drop migration 349's fully-open policies ───────────────────────────

DROP POLICY IF EXISTS "Authenticated users can read all raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Authenticated users can insert raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Authenticated users can update raw_materials" ON raw_materials;
DROP POLICY IF EXISTS "Authenticated users can delete raw_materials" ON raw_materials;
-- Defensive — 069's original per-user policy, in case it was never actually
-- dropped live despite 349 saying it would be.
DROP POLICY IF EXISTS "Users can manage their raw_materials" ON raw_materials;

CREATE POLICY "org_select_raw_materials" ON raw_materials FOR SELECT
    USING (
        organization_id IS NULL
        OR organization_id IN (SELECT current_user_org_ids())
    );

CREATE POLICY "org_insert_raw_materials" ON raw_materials FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_raw_materials" ON raw_materials FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_raw_materials" ON raw_materials FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

NOTIFY pgrst, 'reload schema';

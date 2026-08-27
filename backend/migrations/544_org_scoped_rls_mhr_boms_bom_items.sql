-- ============================================================================
-- Migration 544: Org-scoped RLS for mhr_records, boms, bom_items
--
-- Phase 2 RLS step of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md). Replaces the per-individual-user
-- policies from migrations/019_rls_authorization.sql (boms, bom_items) and
-- migrations/020_fix_rls_authorization.sql (mhr_records) with organization-
-- scoped ones built on current_user_org_ids() (migration 541).
--
-- is_user_authorized() (the platform allowlist gate) is kept ANDed onto
-- every command exactly as it was before — it's orthogonal to the org
-- boundary, not being changed here.
--
-- mhr_records ground truth checked directly against the live DB before
-- writing this (2026-08-22): all 438 rows have is_global = false, confirming
-- database/migrations/156_promote_library_data_global.sql's
-- "UPDATE mhr_records SET is_global = TRUE" never actually ran against this
-- project — so the master_select_own_and_global-style policies it would
-- have created don't exist live either. The DROP POLICY IF EXISTS lines for
-- those names below are defensive (no-op if absent), not evidence they do.
--
-- mhr_records keeps a TRANSITIONAL clause on all 4 commands:
-- (organization_id IS NULL AND user_id = auth.uid()) preserves exactly
-- today's owner-only access for the 425 rows owned by
-- 417c3a4c-16c7-4467-93c6-1299c618c22b, who has no organization_members row
-- and was deliberately NOT backfilled by migration 543 pending confirmation
-- of who that account is. Once that's resolved and those rows get a real
-- organization_id, this transitional clause becomes dead weight for them —
-- it should be dropped in a follow-up migration at that point, not left
-- indefinitely.
--
-- boms/bom_items get NO transitional clause — migration 543's backfill
-- covers 100% of their rows (both tables have ever only been written to by
-- the one existing organization's owner).
-- ============================================================================

-- ── mhr_records ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authorized users can view their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Authorized users can insert their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Authorized users can update their own MHR records" ON mhr_records;
DROP POLICY IF EXISTS "Authorized users can delete their own MHR records" ON mhr_records;
-- Defensive only (see note above) — these are not confirmed to exist live.
DROP POLICY IF EXISTS "master_select_own_and_global" ON mhr_records;
DROP POLICY IF EXISTS "master_insert_own" ON mhr_records;
DROP POLICY IF EXISTS "master_update_own" ON mhr_records;
DROP POLICY IF EXISTS "master_delete_own" ON mhr_records;

CREATE POLICY "org_select_own_and_global" ON mhr_records FOR SELECT
    USING (
        is_user_authorized() AND (
            (organization_id IS NOT NULL AND organization_id IN (SELECT current_user_org_ids()))
            OR (organization_id IS NULL AND user_id = auth.uid())
            OR (organization_id IS NULL AND user_id IS NULL)
        )
    );

CREATE POLICY "org_insert_own" ON mhr_records FOR INSERT
    WITH CHECK (
        is_user_authorized() AND (
            (organization_id IS NOT NULL AND organization_id IN (SELECT current_user_org_ids()))
            OR (organization_id IS NULL AND user_id = auth.uid())
        )
    );

CREATE POLICY "org_update_own" ON mhr_records FOR UPDATE
    USING (
        is_user_authorized() AND (
            (organization_id IS NOT NULL AND organization_id IN (SELECT current_user_org_ids()))
            OR (organization_id IS NULL AND user_id = auth.uid())
        )
    )
    WITH CHECK (
        is_user_authorized() AND (
            (organization_id IS NOT NULL AND organization_id IN (SELECT current_user_org_ids()))
            OR (organization_id IS NULL AND user_id = auth.uid())
        )
    );

CREATE POLICY "org_delete_own" ON mhr_records FOR DELETE
    USING (
        is_user_authorized() AND (
            (organization_id IS NOT NULL AND organization_id IN (SELECT current_user_org_ids()))
            OR (organization_id IS NULL AND user_id = auth.uid())
        )
    );

-- ── boms ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Authorized users can view their own boms" ON boms;
DROP POLICY IF EXISTS "Authorized users can insert their own boms" ON boms;
DROP POLICY IF EXISTS "Authorized users can update their own boms" ON boms;
DROP POLICY IF EXISTS "Authorized users can delete their own boms" ON boms;

CREATE POLICY "org_select_boms" ON boms FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_boms" ON boms FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_boms" ON boms FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_boms" ON boms FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── bom_items ────────────────────────────────────────────────────────────────
-- Was an EXISTS-join to boms.user_id; now checks bom_items' own
-- organization_id column directly (added in migration 542) instead of
-- joining to its parent bom on every row check.

DROP POLICY IF EXISTS "Authorized users can view bom_items for their boms" ON bom_items;
DROP POLICY IF EXISTS "Authorized users can insert bom_items for their boms" ON bom_items;
DROP POLICY IF EXISTS "Authorized users can update bom_items for their boms" ON bom_items;
DROP POLICY IF EXISTS "Authorized users can delete bom_items for their boms" ON bom_items;

CREATE POLICY "org_select_bom_items" ON bom_items FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_insert_bom_items" ON bom_items FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_update_bom_items" ON bom_items FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

CREATE POLICY "org_delete_bom_items" ON bom_items FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

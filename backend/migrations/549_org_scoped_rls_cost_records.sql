-- ============================================================================
-- Migration 549: Org-scoped RLS for the cost-records cluster
--
-- Phase 2b RLS step (see .claude/plans/delegated-gliding-swan.md). Replaces
-- the per-individual-user policies with organization-scoped ones built on
-- current_user_org_ids() (migration 541), same pattern as migration 544.
--
-- is_user_authorized() is preserved exactly where it existed before and
-- nowhere else: process_cost_records had it (migrations/021_complete_rls_
-- authorization_fix_v2.sql); bom_item_costs, raw_material_cost_records,
-- packaging_logistics_cost_records, procured_parts_cost_records, and
-- tooling_cost_records never did. Not standardizing this now — orthogonal
-- to the org boundary, out of scope for this migration.
--
-- No transitional clause on any of these 6 (see migration 548 — every row
-- across all 6 tables belongs to the one existing org owner, verified live).
-- ============================================================================

-- ── bom_item_costs (no is_user_authorized) ───────────────────────────────────

DROP POLICY IF EXISTS "Users can view own cost records" ON bom_item_costs;
DROP POLICY IF EXISTS "Users can insert own cost records" ON bom_item_costs;
DROP POLICY IF EXISTS "Users can update own cost records" ON bom_item_costs;
DROP POLICY IF EXISTS "Users can delete own cost records" ON bom_item_costs;

CREATE POLICY "org_select_bom_item_costs" ON bom_item_costs FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_bom_item_costs" ON bom_item_costs FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_bom_item_costs" ON bom_item_costs FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_bom_item_costs" ON bom_item_costs FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── raw_material_cost_records (no is_user_authorized) ────────────────────────

DROP POLICY IF EXISTS "Users can view own raw material costs" ON raw_material_cost_records;
DROP POLICY IF EXISTS "Users can insert own raw material costs" ON raw_material_cost_records;
DROP POLICY IF EXISTS "Users can update own raw material costs" ON raw_material_cost_records;
DROP POLICY IF EXISTS "Users can delete own raw material costs" ON raw_material_cost_records;

CREATE POLICY "org_select_raw_material_cost_records" ON raw_material_cost_records FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_raw_material_cost_records" ON raw_material_cost_records FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_raw_material_cost_records" ON raw_material_cost_records FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_raw_material_cost_records" ON raw_material_cost_records FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── process_cost_records (KEEPS is_user_authorized) ──────────────────────────

DROP POLICY IF EXISTS "Authorized users can view their own process cost records" ON process_cost_records;
DROP POLICY IF EXISTS "Authorized users can insert their own process cost records" ON process_cost_records;
DROP POLICY IF EXISTS "Authorized users can update their own process cost records" ON process_cost_records;
DROP POLICY IF EXISTS "Authorized users can delete their own process cost records" ON process_cost_records;

CREATE POLICY "org_select_process_cost_records" ON process_cost_records FOR SELECT
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_process_cost_records" ON process_cost_records FOR INSERT
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_process_cost_records" ON process_cost_records FOR UPDATE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_process_cost_records" ON process_cost_records FOR DELETE
    USING (is_user_authorized() AND organization_id IN (SELECT current_user_org_ids()));

-- ── packaging_logistics_cost_records (no is_user_authorized) ─────────────────

DROP POLICY IF EXISTS "Users can view own packaging/logistics costs" ON packaging_logistics_cost_records;
DROP POLICY IF EXISTS "Users can insert own packaging/logistics costs" ON packaging_logistics_cost_records;
DROP POLICY IF EXISTS "Users can update own packaging/logistics costs" ON packaging_logistics_cost_records;
DROP POLICY IF EXISTS "Users can delete own packaging/logistics costs" ON packaging_logistics_cost_records;

CREATE POLICY "org_select_packaging_logistics_cost_records" ON packaging_logistics_cost_records FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_packaging_logistics_cost_records" ON packaging_logistics_cost_records FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_packaging_logistics_cost_records" ON packaging_logistics_cost_records FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_packaging_logistics_cost_records" ON packaging_logistics_cost_records FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── procured_parts_cost_records (no is_user_authorized) ──────────────────────

DROP POLICY IF EXISTS "Users can view own procured parts costs" ON procured_parts_cost_records;
DROP POLICY IF EXISTS "Users can insert own procured parts costs" ON procured_parts_cost_records;
DROP POLICY IF EXISTS "Users can update own procured parts costs" ON procured_parts_cost_records;
DROP POLICY IF EXISTS "Users can delete own procured parts costs" ON procured_parts_cost_records;

CREATE POLICY "org_select_procured_parts_cost_records" ON procured_parts_cost_records FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_procured_parts_cost_records" ON procured_parts_cost_records FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_procured_parts_cost_records" ON procured_parts_cost_records FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_procured_parts_cost_records" ON procured_parts_cost_records FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

-- ── tooling_cost_records (no is_user_authorized) ─────────────────────────────

DROP POLICY IF EXISTS "Users can view own tooling cost records" ON tooling_cost_records;
DROP POLICY IF EXISTS "Users can insert own tooling cost records" ON tooling_cost_records;
DROP POLICY IF EXISTS "Users can update own tooling cost records" ON tooling_cost_records;
DROP POLICY IF EXISTS "Users can delete own tooling cost records" ON tooling_cost_records;

CREATE POLICY "org_select_tooling_cost_records" ON tooling_cost_records FOR SELECT
    USING (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_insert_tooling_cost_records" ON tooling_cost_records FOR INSERT
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_update_tooling_cost_records" ON tooling_cost_records FOR UPDATE
    USING (organization_id IN (SELECT current_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
CREATE POLICY "org_delete_tooling_cost_records" ON tooling_cost_records FOR DELETE
    USING (organization_id IN (SELECT current_user_org_ids()));

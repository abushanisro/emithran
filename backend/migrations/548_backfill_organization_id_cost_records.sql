-- ============================================================================
-- Migration 548: Backfill organization_id for the cost-records cluster
--
-- Verified directly against the live DB before writing this (2026-08-22):
-- every row in all 6 tables is owned by the single org owner
-- (5572f34d-2f51-456e-a5d7-96f840128b50) — no orphan-user or NULL-owner rows
-- in this cluster (unlike mhr_records), so no transitional RLS clause is
-- needed for any of these 6 tables in migration 549.
-- ============================================================================

UPDATE bom_item_costs
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE raw_material_cost_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE process_cost_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE packaging_logistics_cost_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE procured_parts_cost_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE tooling_cost_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

-- ============================================================================
-- Migration 560: Backfill organization_id for the supplier-evaluation-groups cluster
--
-- Verified directly against the live DB before writing this (2026-08-23):
-- all 11 supplier_evaluation_groups rows are owned by the single org owner
-- (5572f34d-2f51-456e-a5d7-96f840128b50). supplier_evaluation_group_bom_items
-- (15 rows) inherits organization_id via join to its parent group — it has
-- no user_id of its own. The other 5 tables in this cluster have zero live
-- rows — nothing to backfill.
-- ============================================================================

UPDATE supplier_evaluation_groups
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE supplier_evaluation_group_bom_items
SET organization_id = seg.organization_id
FROM supplier_evaluation_groups seg
WHERE supplier_evaluation_group_bom_items.evaluation_group_id = seg.id
  AND supplier_evaluation_group_bom_items.organization_id IS NULL
  AND seg.organization_id IS NOT NULL;

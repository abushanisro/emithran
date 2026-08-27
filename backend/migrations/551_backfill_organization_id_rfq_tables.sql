-- ============================================================================
-- Migration 551: Backfill organization_id for the RFQ table cluster
--
-- Verified directly against the live DB before writing this (2026-08-22):
-- all 17 rfq_records rows and all 3 rfq_tracking rows are owned by the
-- single org owner (5572f34d-2f51-456e-a5d7-96f840128b50) — no orphan-user
-- rows in this cluster.
-- ============================================================================

UPDATE rfq_records
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

UPDATE rfq_tracking
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

-- rfq_tracking_vendors/rfq_tracking_parts have no user_id of their own —
-- inherit organization_id from their parent rfq_tracking row.
UPDATE rfq_tracking_vendors
SET organization_id = rfq_tracking.organization_id
FROM rfq_tracking
WHERE rfq_tracking_vendors.rfq_tracking_id = rfq_tracking.id
  AND rfq_tracking_vendors.organization_id IS NULL
  AND rfq_tracking.organization_id IS NOT NULL;

UPDATE rfq_tracking_parts
SET organization_id = rfq_tracking.organization_id
FROM rfq_tracking
WHERE rfq_tracking_parts.rfq_tracking_id = rfq_tracking.id
  AND rfq_tracking_parts.organization_id IS NULL
  AND rfq_tracking.organization_id IS NOT NULL;

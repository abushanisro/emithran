-- ============================================================================
-- Migration 550: Add organization_id to the RFQ table cluster
--
-- Phase 3 of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md) — rfq_records, rfq_tracking,
-- rfq_tracking_vendors, rfq_tracking_parts. rfq_records's own migration
-- (043_rfq_system.sql) already flagged its user_id column
-- "TRANSITIONAL - P1: Add organization_id" — this is that P1.
--
-- rfq_tracking_vendors/rfq_tracking_parts get their own organization_id
-- column (denormalized, same choice already made for bom_items) rather than
-- relying on an EXISTS join to rfq_tracking at every RLS check.
--
-- rfq_email_logs is NOT touched here — it has no user_id of its own; its
-- visibility already derives entirely from a join to rfq_records, and its
-- write policy is deliberately service-role-only (system/webhook writes).
-- Its SELECT policy is updated in migration 552 to join on the new
-- organization_id instead of user_id.
-- ============================================================================

ALTER TABLE rfq_records          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE rfq_tracking         ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE rfq_tracking_vendors ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE rfq_tracking_parts   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_rfq_records_organization_id          ON rfq_records(organization_id)          WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_tracking_organization_id         ON rfq_tracking(organization_id)         WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_tracking_vendors_organization_id ON rfq_tracking_vendors(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rfq_tracking_parts_organization_id   ON rfq_tracking_parts(organization_id)   WHERE organization_id IS NOT NULL;

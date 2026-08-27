-- ============================================================================
-- Migration 559: Add organization_id to the supplier-evaluation-groups cluster
--
-- Phase 6 of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md). Audited first (forked subagent):
-- 7 tables, not 1 — supplier_evaluation_groups (11 real rows) plus 6 tables
-- created across migrations 053/054 that all derive ownership from it via
-- EXISTS joins: supplier_evaluation_group_bom_items (15 real rows),
-- supplier_evaluation_group_processes, supplier_evaluation_vendor_selections,
-- supplier_evaluation_rfq_responses, supplier_evaluation_rfq_line_items,
-- supplier_evaluation_activities (all 0 rows live). Each gets its own
-- organization_id column (denormalized, same choice already made for
-- bom_items/rfq_tracking_vendors/rfq_tracking_parts) rather than keeping the
-- EXISTS-join chain for RLS checks.
--
-- NOTE: this is a distinct, unrelated feature from supplier_evaluation_records/
-- supplier_performance_records (migrations 042/164) — confirmed via code
-- audit (different service files, no cross-reference) and both of those are
-- live-but-empty; not touched here.
-- ============================================================================

ALTER TABLE supplier_evaluation_groups             ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_evaluation_group_bom_items     ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_evaluation_group_processes     ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_evaluation_vendor_selections   ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_evaluation_rfq_responses       ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_evaluation_rfq_line_items      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE supplier_evaluation_activities          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_seg_organization_id    ON supplier_evaluation_groups(organization_id)           WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segbi_organization_id  ON supplier_evaluation_group_bom_items(organization_id)  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segp_organization_id   ON supplier_evaluation_group_processes(organization_id)  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sevs_organization_id   ON supplier_evaluation_vendor_selections(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_serr_organization_id   ON supplier_evaluation_rfq_responses(organization_id)     WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_serli_organization_id  ON supplier_evaluation_rfq_line_items(organization_id)    WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sea_organization_id    ON supplier_evaluation_activities(organization_id)        WHERE organization_id IS NOT NULL;

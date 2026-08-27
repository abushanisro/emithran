-- ============================================================================
-- Migration 547: Add organization_id to the 6-table cost-records cluster
--
-- Phase 2b of the org-scoped tenancy initiative (see
-- .claude/plans/delegated-gliding-swan.md) — extends the pattern proven on
-- mhr_records/boms/bom_items to the cost-record tables that feed BOM total
-- cost calculations. Converting bom_item_costs alone would have left a
-- silent wrong-total-cost bug (an org-mate's packaging/tooling/procured/
-- raw-material/process costs invisible to a recalculation) — these 6 tables
-- are converted together for that reason, confirmed via a full audit of the
-- 16 files that read/write them before writing this migration.
--
-- None of these 6 tables had a pre-existing dormant organization_id column
-- (unlike boms) — plain ADD COLUMN + partial index for all of them.
-- ============================================================================

ALTER TABLE bom_item_costs                  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE raw_material_cost_records       ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE process_cost_records            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE packaging_logistics_cost_records ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE procured_parts_cost_records      ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE tooling_cost_records             ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_bom_item_costs_organization_id                  ON bom_item_costs(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_raw_material_cost_records_organization_id      ON raw_material_cost_records(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_cost_records_organization_id          ON process_cost_records(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_packaging_logistics_cost_records_organization_id ON packaging_logistics_cost_records(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_procured_parts_cost_records_organization_id    ON procured_parts_cost_records(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tooling_cost_records_organization_id          ON tooling_cost_records(organization_id) WHERE organization_id IS NOT NULL;

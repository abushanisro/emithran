-- Migration 330: Persistent, aPriori-style manual overrides for the Cost Summary.
--
-- Before this, "edit a cost line" (material rate/kg, per-process rate/hr, per-
-- process cycle time) was pure React useState in CostSummaryTab — refresh the
-- page, close the tab, or open it on another machine and every manual
-- adjustment silently vanished. That's not viable for a quoting tool: a cost
-- engineer's override on a live quote has to survive a refresh and be visible
-- to a teammate opening the same BOM item.
--
-- Scoped by (bom_item_id, location, field_key) — mirrors migration 329's
-- machine-override location scoping for the same reason: an override entered
-- while viewing India must not silently apply after switching to USA/China,
-- since the cost basis (currency, rates) is entirely different per location.
--
-- field_key values: 'mat_rate' | '<process>::rate' | '<process>::cycleMin'
-- (process = ProcessLineCost.process, e.g. 'Laser Cutting', 'Press Brake').

CREATE TABLE IF NOT EXISTS bom_item_cost_overrides (
  bom_item_id   UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
  location      VARCHAR(64) NOT NULL,
  field_key     VARCHAR(96) NOT NULL,
  value         NUMERIC(14,4) NOT NULL,
  overridden_by UUID,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bom_item_id, location, field_key)
);

ALTER TABLE bom_item_cost_overrides ENABLE ROW LEVEL SECURITY;

-- Access follows bom_items visibility, same pattern as bom_item_machine_overrides.
CREATE POLICY "Users can view cost overrides for visible BOM items"
  ON bom_item_cost_overrides FOR SELECT
  USING (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id));

CREATE POLICY "Users can manage cost overrides for visible BOM items"
  ON bom_item_cost_overrides FOR ALL
  USING (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id));

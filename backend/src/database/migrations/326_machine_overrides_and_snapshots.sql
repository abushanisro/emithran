-- Migration 326: Machine override persistence + selection snapshots
-- Overrides: a cost engineer's explicit machine choice per (BOM item, process).
-- Snapshots: append-only record of what the selector chose, so a quote can be
-- explained months later ("why VMC-540 and not VMC-850?") against the maichine
-- capability definitions (capability_version) in force at the time.

CREATE TABLE IF NOT EXISTS bom_item_machine_overrides (
  bom_item_id   UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
  process_key   VARCHAR(64) NOT NULL,   -- machine class key: 'fiber_laser' | 'press_brake' | 'cnc_3ax_vmc' | ...
  mhr_record_id UUID NOT NULL REFERENCES mhr_records(id) ON DELETE CASCADE,
  overridden_by UUID,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bom_item_id, process_key)
);

CREATE TABLE IF NOT EXISTS bom_item_machine_selection_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id         UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
  process_key         VARCHAR(64) NOT NULL,
  selected_machine_id UUID,               -- NULL when class-default fallback was used
  capability_version  INTEGER,
  selection_json      JSONB NOT NULL,     -- full MachineSelectionResult at selection time
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_machine_selection_snapshots_item
  ON bom_item_machine_selection_snapshots (bom_item_id, process_key, created_at DESC);

ALTER TABLE bom_item_machine_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_item_machine_selection_snapshots ENABLE ROW LEVEL SECURITY;

-- Access follows bom_items visibility: if the user can see the BOM item
-- (bom_items has its own RLS), they can read/write its overrides and snapshots.
CREATE POLICY "Users can view machine overrides for visible BOM items"
  ON bom_item_machine_overrides FOR SELECT
  USING (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id));

CREATE POLICY "Users can manage machine overrides for visible BOM items"
  ON bom_item_machine_overrides FOR ALL
  USING (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id))
  WITH CHECK (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id));

CREATE POLICY "Users can view selection snapshots for visible BOM items"
  ON bom_item_machine_selection_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id));

CREATE POLICY "Users can insert selection snapshots for visible BOM items"
  ON bom_item_machine_selection_snapshots FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM bom_items b WHERE b.id = bom_item_id));

-- Migration 147: Add lot_id to quality_inspections for lot-scoped item filtering

ALTER TABLE quality_inspections
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES production_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quality_inspections_lot_id ON quality_inspections(lot_id);

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('147', 'Add lot_id to quality_inspections for lot-scoped item filtering')
ON CONFLICT (version) DO NOTHING;

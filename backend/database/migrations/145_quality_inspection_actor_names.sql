-- Migration 145: Add human-readable actor name columns to quality_inspections

ALTER TABLE quality_inspections
    ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
    ADD COLUMN IF NOT EXISTS rejected_by_name TEXT;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('145', 'Add approved_by_name and rejected_by_name text columns to quality_inspections')
ON CONFLICT (version) DO NOTHING;

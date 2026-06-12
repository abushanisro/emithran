-- Migration 134: Add missing columns to remarks_and_issues
-- The table was created from an older schema that omitted applies_to and bom_part_id.
-- Migration 096 defines the full schema but was apparently applied without these columns.

-- applies_to is required (NOT NULL) in remark.service.ts inserts
ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS applies_to VARCHAR(20)
        CHECK (applies_to IN ('LOT', 'PROCESS', 'SUBTASK', 'BOM_PART'));

-- Back-fill existing rows so the column satisfies any future NOT NULL constraint
UPDATE remarks_and_issues
SET applies_to = 'LOT'
WHERE applies_to IS NULL;

-- bom_part_id used by the remark service when linking a remark to a specific BOM item
ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS bom_part_id UUID REFERENCES bom_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_remarks_bom_part_id
    ON remarks_and_issues(bom_part_id) WHERE bom_part_id IS NOT NULL;

-- Also ensure all other columns from migration 096 exist in case they were missing

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS subtask_id UUID REFERENCES process_subtasks(id) ON DELETE SET NULL;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS context_reference VARCHAR(255);

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS assigned_to UUID;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS reported_date TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS resolved_date TIMESTAMP WITH TIME ZONE;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS impact_level VARCHAR(20)
        CHECK (impact_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS estimated_delay_hours INTEGER DEFAULT 0;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS actual_delay_hours INTEGER DEFAULT 0;

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS tags TEXT[];

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

INSERT INTO schema_migrations (version, description)
VALUES ('134', 'Add applies_to, bom_part_id, and other missing columns to remarks_and_issues')
ON CONFLICT (version) DO NOTHING;

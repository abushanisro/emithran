-- Migration 136: Add all remaining missing columns to remarks_and_issues
-- The original table only had: id, title, description, remark_type, priority, status,
-- created_at, updated_at.  Each migration added a few more.  This adds everything left.

-- Core scope / relationship columns
ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS process_id UUID REFERENCES production_processes(id) ON DELETE SET NULL;

-- Ensure updated_at exists (may be missing on some installs)
ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Ensure created_at exists
ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Indexes that may never have been created
CREATE INDEX IF NOT EXISTS idx_remarks_process_id ON remarks_and_issues(process_id);

INSERT INTO schema_migrations (version, description)
VALUES ('136', 'Add process_id and ensure created_at/updated_at on remarks_and_issues')
ON CONFLICT (version) DO NOTHING;

-- Migration 139: Add core content columns missing from remarks_comments
-- After schema cache reload the real table state was revealed: comment_text,
-- remark_id, and other basic columns from migration 096 are absent.

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS remark_id UUID REFERENCES remarks_and_issues(id) ON DELETE CASCADE;

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS comment_text TEXT;

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_remarks_comments_remark_id
    ON remarks_comments(remark_id);

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('139', 'Add remark_id, comment_text, timestamps to remarks_comments')
ON CONFLICT (version) DO NOTHING;

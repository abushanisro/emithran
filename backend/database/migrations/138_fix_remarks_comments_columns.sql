-- Migration 138: Add missing columns to remarks_comments
-- Migration 100 created the table with only: id, remark_id, comment_text, created_by,
-- created_at, updated_at.  The service (migration 096 schema) needs author_id,
-- author_name, parent_comment_id, and thread_level.

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS author_id UUID;

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS author_name VARCHAR(255);

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS parent_comment_id UUID REFERENCES remarks_comments(id) ON DELETE CASCADE;

ALTER TABLE remarks_comments
    ADD COLUMN IF NOT EXISTS thread_level INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_remarks_comments_author_id
    ON remarks_comments(author_id);

CREATE INDEX IF NOT EXISTS idx_remarks_comments_parent_id
    ON remarks_comments(parent_comment_id);

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('138', 'Add author_id, author_name, parent_comment_id, thread_level to remarks_comments')
ON CONFLICT (version) DO NOTHING;

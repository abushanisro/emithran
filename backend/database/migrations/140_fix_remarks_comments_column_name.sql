-- Migration 140: Rename remarks_comments.comment → comment_text
-- The actual column is named 'comment' (NOT NULL) but the service inserts 'comment_text'.
-- Migration 139 added a separate nullable 'comment_text' column which caused the NOT NULL
-- violation on the original 'comment' column.  Fix: drop the duplicate, rename the original.

-- Drop the duplicate comment_text column added by migration 139
ALTER TABLE remarks_comments
    DROP COLUMN IF EXISTS comment_text;

-- Rename the real column to match what the service expects
ALTER TABLE remarks_comments
    RENAME COLUMN comment TO comment_text;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('140', 'Rename remarks_comments.comment to comment_text')
ON CONFLICT (version) DO NOTHING;

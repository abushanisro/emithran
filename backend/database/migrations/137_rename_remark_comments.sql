-- Migration 137: Rename remark_comments → remarks_comments
-- Migration 100 created the table as 'remark_comments' but the service queries
-- 'remarks_comments' (matching migration 096 which defined it with the 's').

ALTER TABLE remark_comments RENAME TO remarks_comments;

-- Re-create index names to match the new table name (optional but keeps naming consistent)
ALTER INDEX IF EXISTS idx_remark_comments_remark_id   RENAME TO idx_remarks_comments_remark_id;
ALTER INDEX IF EXISTS idx_remark_comments_created_by  RENAME TO idx_remarks_comments_created_by;
ALTER INDEX IF EXISTS idx_remark_comments_created_at  RENAME TO idx_remarks_comments_created_at;

INSERT INTO schema_migrations (version, description)
VALUES ('137', 'Rename remark_comments to remarks_comments to match service queries')
ON CONFLICT (version) DO NOTHING;

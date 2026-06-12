-- Migration 135: Add created_by to remarks_and_issues, fix assigned_to type
-- The table was created from a stripped-down schema missing this core column.

ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS created_by UUID;

-- assigned_to was added in 134 as UUID, but the frontend sends names/strings (not UUIDs).
-- Change to VARCHAR so name strings are accepted.
ALTER TABLE remarks_and_issues
    ALTER COLUMN assigned_to TYPE VARCHAR(255)
    USING assigned_to::text;

INSERT INTO schema_migrations (version, description)
VALUES ('135', 'Add created_by, fix assigned_to type to VARCHAR on remarks_and_issues')
ON CONFLICT (version) DO NOTHING;

-- Migration 131: Add missing columns to process_subtasks
-- process_subtasks exists but was created without created_by and estimated_duration_hours

ALTER TABLE process_subtasks
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS estimated_duration_hours DECIMAL(8,2);

-- Ensure status check constraint allows the values the backend inserts
DO $$ BEGIN
    -- Drop old check constraint if it exists with a different name
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'process_subtasks_status_check'
          AND conrelid = 'process_subtasks'::regclass
    ) THEN
        ALTER TABLE process_subtasks DROP CONSTRAINT process_subtasks_status_check;
    END IF;
END $$;

ALTER TABLE process_subtasks
    ADD CONSTRAINT process_subtasks_status_check
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'pending', 'in_progress', 'completed', 'blocked'));

-- Reload PostgREST schema cache so it picks up the new columns
NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('131', 'Add created_by and estimated_duration_hours to process_subtasks; reload schema cache')
ON CONFLICT (version) DO NOTHING;

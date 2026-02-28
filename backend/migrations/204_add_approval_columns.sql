-- Add approval and rejection columns to quality_inspections table
-- This migration is idempotent and safe to run multiple times

-- Add approval columns if they don't exist
DO $$
BEGIN
    -- Add approved_by column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quality_inspections' 
        AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE quality_inspections 
        ADD COLUMN approved_by VARCHAR(255);
    END IF;

    -- Add approved_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quality_inspections' 
        AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE quality_inspections 
        ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add rejected_by column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quality_inspections' 
        AND column_name = 'rejected_by'
    ) THEN
        ALTER TABLE quality_inspections 
        ADD COLUMN rejected_by VARCHAR(255);
    END IF;

    -- Add rejected_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quality_inspections' 
        AND column_name = 'rejected_at'
    ) THEN
        ALTER TABLE quality_inspections 
        ADD COLUMN rejected_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Add rejection_reason column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'quality_inspections' 
        AND column_name = 'rejection_reason'
    ) THEN
        ALTER TABLE quality_inspections 
        ADD COLUMN rejection_reason TEXT;
    END IF;
END $$;

-- Create indexes for performance (only if they don't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_quality_inspections_approved_by'
    ) THEN
        CREATE INDEX idx_quality_inspections_approved_by 
            ON quality_inspections(approved_by);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_quality_inspections_approved_at'
    ) THEN
        CREATE INDEX idx_quality_inspections_approved_at 
            ON quality_inspections(approved_at);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_quality_inspections_status'
    ) THEN
        CREATE INDEX idx_quality_inspections_status 
            ON quality_inspections(status);
    END IF;
END $$;

-- Add comments
COMMENT ON COLUMN quality_inspections.approved_by IS 'User ID who approved the inspection';
COMMENT ON COLUMN quality_inspections.approved_at IS 'Timestamp when the inspection was approved';
COMMENT ON COLUMN quality_inspections.rejected_by IS 'User ID who rejected the inspection';
COMMENT ON COLUMN quality_inspections.rejected_at IS 'Timestamp when the inspection was rejected';
COMMENT ON COLUMN quality_inspections.rejection_reason IS 'Reason for rejecting the inspection';
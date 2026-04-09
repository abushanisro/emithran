-- Migration: Add manual MHR entry fields to mhr_records table
-- Purpose: Support manual MHR value entry bypass automatic calculations
-- Date: 2026-04-08

-- Add manual entry flag and manual MHR value columns
ALTER TABLE mhr_records 
ADD COLUMN IF NOT EXISTS is_manual_entry BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS manual_mhr_value DECIMAL(12,4) DEFAULT NULL;

-- Add index for performance on manual entry queries
CREATE INDEX IF NOT EXISTS idx_mhr_records_manual_entry ON mhr_records(is_manual_entry) WHERE is_manual_entry = TRUE;

-- Add comment to document the new columns
COMMENT ON COLUMN mhr_records.is_manual_entry IS 'Flag indicating if this is a manual MHR entry that skips automatic calculation';
COMMENT ON COLUMN mhr_records.manual_mhr_value IS 'Manually entered MHR value in INR per hour (only used when is_manual_entry is true)';

-- Update existing records to set default values
UPDATE mhr_records 
SET is_manual_entry = FALSE, manual_mhr_value = NULL 
WHERE is_manual_entry IS NULL;
-- ============================================================================
-- Migration 310: Restore date columns to production_processes and add quality_status
-- Migration 101 (database/migrations) dropped planned_start_date and planned_end_date
-- from production_processes. Migration 102 only re-added them to production_lots.
-- quality_status was never added to the 086 table schema.
-- ============================================================================

ALTER TABLE production_processes
  ADD COLUMN IF NOT EXISTS planned_start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS planned_end_date   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quality_status VARCHAR(50) DEFAULT 'pending'
    CHECK (quality_status IN ('pending', 'in_progress', 'passed', 'failed', 'rework_required'));

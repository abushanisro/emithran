-- ============================================================================
-- Migration 557: Backfill organization_id for process_plan_generations
--
-- Verified directly against the live DB before writing this (2026-08-23):
-- all 13 process_plan_generations rows are owned by the single org owner
-- (5572f34d-2f51-456e-a5d7-96f840128b50). process_plan_line_edits has zero
-- rows live — nothing to backfill there.
-- ============================================================================

UPDATE process_plan_generations
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

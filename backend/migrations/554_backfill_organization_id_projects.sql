-- ============================================================================
-- Migration 554: Backfill organization_id for projects
--
-- Verified directly against the live DB before writing this (2026-08-22):
-- all 4 projects rows are owned by the single org owner
-- (5572f34d-2f51-456e-a5d7-96f840128b50).
-- ============================================================================

UPDATE projects
SET organization_id = 'cd0d0963-419a-44b6-8b06-6b38bd547946'
WHERE user_id = '5572f34d-2f51-456e-a5d7-96f840128b50' AND organization_id IS NULL;

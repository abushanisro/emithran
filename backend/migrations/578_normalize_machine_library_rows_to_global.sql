-- ============================================================================
-- Migration 578: Normalize machine_library.json reference rows back to Global
--
-- Context: mhr_records ground truth checked directly against the live DB
-- (2026-08-27) — of the 281 rows carrying a benchmark_source_key (the
-- "<category>:<machine name>" identifier unique to machine_library.json
-- imports, one-to-one with the 281 machines in that file), 257 were found
-- scoped to a real account (user_id = 5572f34d-2f51-456e-a5d7-96f840128b50,
-- organization_id = cd0d0963-419a-44b6-8b06-6b38bd547946 — the "abysha" org)
-- instead of being global (user_id IS NULL). Only 24 rows (12 Progressive Die
-- Press + 12 Tandem Press) were already correctly global. This is why the
-- "Global" badge (hr-rates/page.tsx, MHRFormDialog.tsx: `!record.userId`)
-- showed inconsistently within the very same reference category.
--
-- Root cause: whatever one-time process loaded machine_library.json into
-- mhr_records (the "clean Excel pipeline" import) was run through the
-- general-purpose importFromExcel() path (mhr.service.ts), which always
-- stamps `user_id: userId` from the calling session — appropriate for a real
-- shop uploading their own custom machine costs, wrong for a shared reference
-- library load. That one-time script is not part of the live, committed
-- codebase (nothing to patch there); this migration is the correction, and
-- any future reference-library (re)load must explicitly set user_id/
-- organization_id to NULL rather than reusing importFromExcel() as-is.
--
-- Decision (confirmed with the user, 2026-08-27): this app's architecture is
-- one shared machine reference database for every user — every row sourced
-- from machine_library.json must be user_id/organization_id = NULL, visible
-- to all users/orgs via mhr_records' existing "org_select_own_and_global"
-- RLS policy's `(organization_id IS NULL AND user_id IS NULL)` clause
-- (migration 544). User-created/custom machines (no benchmark_source_key)
-- are untouched by this migration and keep their real ownership.
-- ============================================================================

BEGIN;

UPDATE mhr_records
SET user_id = NULL, organization_id = NULL
WHERE benchmark_source_key IS NOT NULL
  AND (user_id IS NOT NULL OR organization_id IS NOT NULL);

COMMIT;

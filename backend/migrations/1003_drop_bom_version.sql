-- ============================================================================
-- Migration 1003: a BOM has no version
-- ============================================================================
-- boms.version (migration 004) was a free-text label ("1.0", "2.0") with no history, no comparison and nothing that read it: a BOM is only ever
-- its current state. The API, the web app and the production-lot views no longer read or write it. Idempotent.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_boms_version;
ALTER TABLE public.boms DROP COLUMN IF EXISTS version;

NOTIFY pgrst, 'reload schema';

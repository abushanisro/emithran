-- ============================================================================
-- Migration 847: remove the Sand Casting materials staged as JSON
-- ============================================================================
-- Migration 846 used to stage memory/Sand casting/Raw Material as JSON rows
-- (category 'material', raw = the whole row). Those materials now live as
-- real columns of raw_materials (migration 845). This deletes only those JSON
-- rows: category 'material' under source_version 2026-SandCasting. Lookups,
-- variables, processes, operations and wage grades are not touched.
--
-- Run after 845. Idempotent: a second run deletes nothing.
-- ============================================================================

DELETE FROM machining_reference_data
WHERE category = 'material'
  AND source_version = '2026-SandCasting';

NOTIFY pgrst, 'reload schema';

-- Verify (expect 0):
--   SELECT count(*) FROM machining_reference_data
--   WHERE category = 'material' AND source_version = '2026-SandCasting';

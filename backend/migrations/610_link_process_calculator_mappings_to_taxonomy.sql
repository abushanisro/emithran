-- ============================================================================
-- Migration 610: Link process_calculator_mappings to process_taxonomy
-- ============================================================================
-- process_taxonomy (migration 609) is keyed by (process_group, process_name)
-- -- NOT process_route -- specifically so that the same real operation
-- filed under more than one route within a group (confirmed live,
-- 2026-09-01: Sheet Metal's "Waterjet Cutting" under both "Cutting" and
-- "Sheet Cutting"; several Machining/Assembly operations shared across
-- routes) resolves to ONE shared canonical_process_id instead of
-- fragmenting. This backfill therefore joins on (process_group, operation)
-- only, deliberately ignoring process_route -- every live row with a given
-- (group, operation) pair gets the SAME canonical_process_id, closing
-- those duplicates structurally rather than papering over them.
--
-- The RAISE EXCEPTION guard turns "should resolve for all 270 rows" into
-- a hard, verified fact before NOT NULL is applied -- no silent gaps.
-- ============================================================================

BEGIN;

ALTER TABLE process_calculator_mappings
  ADD COLUMN IF NOT EXISTS canonical_process_id UUID REFERENCES process_taxonomy(id);

UPDATE process_calculator_mappings pcm
SET canonical_process_id = pt.id
FROM process_taxonomy pt
WHERE pt.process_group = pcm.process_group
  AND pt.process_name = pcm.operation
  AND pcm.canonical_process_id IS NULL;

DO $$
DECLARE
  unlinked_count INTEGER;
BEGIN
  SELECT count(*) INTO unlinked_count FROM process_calculator_mappings WHERE canonical_process_id IS NULL;
  IF unlinked_count > 0 THEN
    RAISE EXCEPTION 'Migration 610 aborted: % process_calculator_mappings row(s) failed to link to process_taxonomy. Run: SELECT process_group, process_route, operation FROM process_calculator_mappings WHERE canonical_process_id IS NULL; -- to see which rows, then either add them to process_taxonomy (migration 609 seed) or investigate why the join missed them.', unlinked_count;
  END IF;
END $$;

ALTER TABLE process_calculator_mappings
  ALTER COLUMN canonical_process_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_process_calculator_mappings_canonical_process_id
  ON process_calculator_mappings(canonical_process_id);

COMMIT;

-- Verification (run manually after):
-- SELECT count(*) FROM process_calculator_mappings WHERE canonical_process_id IS NULL; -- expect 0
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Confirm the Waterjet Cutting duplicate now shares one id:
-- SELECT process_route, canonical_process_id FROM process_calculator_mappings
--   WHERE process_group = 'Sheet Metal' AND operation = 'Waterjet Cutting';
-- -- Expect 2 rows (Cutting, Sheet Cutting), same canonical_process_id.

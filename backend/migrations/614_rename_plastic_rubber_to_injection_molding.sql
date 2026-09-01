-- ============================================================================
-- Migration 614: Rename process_group "Plastic & Rubber" -> "Injection Molding"
-- ============================================================================
-- After migration 613 trimmed this group down to its only 3 surviving
-- operations (Compression Molding, Injection Molding, Structural foam
-- molding -- all from the Injection Molding digital-factory file), the
-- broader "Plastic & Rubber" label no longer matches its actual content.
--
-- Scope: ONLY process_calculator_mappings.process_group and
-- process_taxonomy.process_group. NOT the unrelated "Plastic & Rubber" raw
-- material commodity category used throughout the Raw Materials module
-- (raw-materials.service.ts, commodityPresets.ts, material-categories,
-- etc.) -- that's a materials-composition taxonomy, a different concept
-- entirely, untouched by this migration.
-- ============================================================================

BEGIN;

UPDATE process_calculator_mappings
SET process_group = 'Injection Molding'
WHERE process_group = 'Plastic & Rubber';

UPDATE process_taxonomy
SET process_group = 'Injection Molding'
WHERE process_group = 'Plastic & Rubber';

COMMIT;

-- Verification (run manually after):
-- SELECT process_group, count(*) FROM process_calculator_mappings GROUP BY process_group ORDER BY process_group;
-- -- Expect: Injection Molding 3, Sheet Metal 68.

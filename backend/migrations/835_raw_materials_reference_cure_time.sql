-- ============================================================================
-- Migration 835: thermoset cure time from the memory/ reference plastics
-- ============================================================================
-- Source: memory/Plastic Modeling/materials_final.csv processingParameters.
-- cureTimeMin (staged by 823), onto the raw_materials rows 831 and 834 link
-- (im_reference_material). Fills only an empty cure_time_min; never
-- overwrites. Needs migration 619 (adds raw_materials.cure_time_min), 831 and
-- 834. One plain statement, idempotent.
-- ============================================================================

UPDATE raw_materials r
SET cure_time_min = (m.raw->>'processingParameters.cureTimeMin')::numeric
FROM machining_reference_data m
WHERE m.category = 'material' AND m.source_version = '2026-Plastic'
  AND r.im_reference_material = m.key
  AND r.cure_time_min IS NULL
  AND m.raw->>'processingParameters.cureTimeMin' IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Verify: SELECT count(*) FROM raw_materials WHERE im_reference_material IS NOT NULL AND cure_time_min IS NOT NULL;

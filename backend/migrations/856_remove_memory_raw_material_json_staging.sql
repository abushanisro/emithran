-- ============================================================================
-- Migration 856: remove the memory/ raw materials staged as JSON
-- ============================================================================
-- Migration 855 moved these materials into raw_materials and raw_material_properties.
-- This deletes only the old JSON rows: category 'material' under the source
-- versions of the domains 848 promoted. Lookups, variables, processes, operations
-- and wage grades are not touched.
--
-- Run after every part of 855. Idempotent: a second run deletes nothing.
-- ============================================================================

DELETE FROM machining_reference_data
WHERE category = 'material'
  AND source_version IN ('2026-Plastic', '2026-Forging', '2026-Additive', '2026-Composites', '2026-PCB', '2026-CastInvest', '2026-DieCasting', '2026-Casting', '2026-PowderMetal', '2026-RapidProto', '2026-RotoBlow', '2026-SheetPlastic', '2026-RollForm', '2026-StretchForm', '2026-TransferDie', '2026-BarTube', '2026-AssyPlastic');

NOTIFY pgrst, 'reload schema';

-- Verify (expect 0):
--   SELECT count(*) FROM machining_reference_data
--   WHERE category = 'material' AND source_version IN ('2026-Plastic', '2026-Forging', '2026-Additive', '2026-Composites', '2026-PCB', '2026-CastInvest', '2026-DieCasting', '2026-Casting', '2026-PowderMetal', '2026-RapidProto', '2026-RotoBlow', '2026-SheetPlastic', '2026-RollForm', '2026-StretchForm', '2026-TransferDie', '2026-BarTube', '2026-AssyPlastic');

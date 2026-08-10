-- ============================================================================
-- Calculator: Sheet Metal - Bending Manufacturing (calculator_id 102772ff-5422-45c1-b391-6d2d4a96ab1b)
--
-- "Tool Loading Time" had data_source=NULL / source_field=NULL despite a
-- real, fully-seeded lookup table (sm_lookup_tool_setup, 26 rows — Lookup
-- Table 3A "press" + Table 3B "brake", memory/sheetmetal/
-- Lookup_Table_3_Tool_Setup_Time.md) already existing AND already having a
-- working resolver case in calculators.service.ts's resolveSheetMetalLookup
-- ('tool_setup') — it was simply never connected to this field. This left
-- "Setup Time" (= Tool Loading Time / Lot Size) permanently unresolvable for
-- every Bending calculation.
--
-- Table 3B keys tool loading time by tool/bend length (mm) for a press
-- brake — the same concept this calculator's own "Bending Line Length"
-- field already represents. source_field='tool_setup' matches the
-- resolver's switch-case name (mirrors 'manual_stroke' for Time Per Stroke,
-- migration 044).
-- ============================================================================

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup',
    source_field = 'tool_setup'
WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
  AND field_name = 'Tool Loading Time';

-- Verification:
-- SELECT field_name, field_type, data_source, source_field
--   FROM calculator_fields WHERE calculator_id = '102772ff-5422-45c1-b391-6d2d4a96ab1b'
--   AND field_name = 'Tool Loading Time';

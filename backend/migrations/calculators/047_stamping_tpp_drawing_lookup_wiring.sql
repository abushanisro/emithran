-- ============================================================================
-- Wire real sheet-metal lookup tables into Stamping / TPP / Drawing-Forming
-- Manufacturing calculators — same class of gap found & fixed for Bending
-- Manufacturing this session (Tool Loading Time / Time Per Stroke / UTS):
-- the tables (sm_lookup_handling_time, sm_lookup_tool_setup) already exist,
-- are already seeded, and already have working resolver cases in
-- calculators.service.ts's resolveSheetMetalLookup() — these fields were
-- simply never connected to them.
--
-- Stamping (e12094c7-...): "Tool Loading Time" -> Lookup Table 3A (press,
--   keyed by tonnage); "Total Coil Loading Time" -> Lookup Table 2 (handling
--   time, keyed by weight).
-- TPP (a5d9b23a-...): "Total Sheet Loading Unloading (min)" -> Lookup Table 2.
--   (TPP has no separate tool-loading-time field in this schema.)
-- Drawing/Forming (966fff11-...): "Tool Loading Time" -> Lookup Table 3A
--   (press, keyed by tonnage — memory/sheetmetal/Sheet_Metal_Calculators.md's
--   DrawingForming section cites "Lookup table 3A" specifically, not 3B);
--   "Sheet Loading Time" -> Lookup Table 2.
-- ============================================================================

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'tool_setup'
WHERE calculator_id = 'e12094c7-cdfd-4dde-a153-1f98a5250a72' AND field_name = 'Tool Loading Time';

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'handling_time'
WHERE calculator_id = 'e12094c7-cdfd-4dde-a153-1f98a5250a72' AND field_name = 'Total Coil Loading Time';

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'handling_time'
WHERE calculator_id = 'a5d9b23a-5b8c-4d2b-98dd-3fa623458716' AND field_name = 'Total Sheet Loading Unloading (min)';

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'tool_setup'
WHERE calculator_id = '966fff11-5b69-44bc-ad55-6645f1df223c' AND field_name = 'Tool Loading Time';

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'handling_time'
WHERE calculator_id = '966fff11-5b69-44bc-ad55-6645f1df223c' AND field_name = 'Sheet Loading Time';

-- Laser Cutting Manufacturing (f8537846-...): "Cutting Speed"/"Piercing Time
-- Per Start" already auto-fill correctly today via a bespoke frontend lookup
-- in ProcessCostDialog.tsx that doesn't check data_source at all — tagging
-- here is for accurate introspection/documentation, not a functional change.
UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'laser_cut'
WHERE calculator_id = 'f8537846-b0eb-4d49-9cfb-a93f6b9e2c63' AND field_name IN ('Cutting Speed', 'Piercing Time Per Start');

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'handling_time'
WHERE calculator_id = 'f8537846-b0eb-4d49-9cfb-a93f6b9e2c63' AND field_name = 'Sheet Loading Time';

-- Verification:
-- SELECT calculator_id, field_name, data_source, source_field FROM calculator_fields
--   WHERE calculator_id IN (
--     'e12094c7-cdfd-4dde-a153-1f98a5250a72', 'a5d9b23a-5b8c-4d2b-98dd-3fa623458716',
--     '966fff11-5b69-44bc-ad55-6645f1df223c', 'f8537846-b0eb-4d49-9cfb-a93f6b9e2c63'
--   ) AND source_field IS NOT NULL;

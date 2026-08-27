-- ============================================================================
-- Migration: Punching tool name reference (staging)
-- Purpose: Lands the "tblpunchingTool" export (8 rows: num pins -> internal
--          tool name, e.g. 4 -> "toolPins_4") into the same lossless staging
--          table earlier migrations created. See migration 479's header for
--          the staging/promotion architecture. No vendor name present in
--          this source file.
--
--          This is the reference source's own internal tool-naming
--          convention, not physical/cost data -- staged for completeness
--          only, same treatment as migration 514's validationDisplayControls.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'punchingTool:1.0', 'toolPins_1', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 1.0, "Tool Name": "toolPins_1"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:4.0', 'toolPins_4', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 4.0, "Tool Name": "toolPins_4"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:9.0', 'toolPins_9', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 9.0, "Tool Name": "toolPins_9"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:16.0', 'toolPins_16', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 16.0, "Tool Name": "toolPins_16"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:25.0', 'toolPins_25', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 25.0, "Tool Name": "toolPins_25"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:36.0', 'toolPins_36', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 36.0, "Tool Name": "toolPins_36"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:49.0', 'toolPins_49', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 49.0, "Tool Name": "toolPins_49"}'::jsonb),
('lookup_table', 'USA', '2026-03', 'punchingTool:64.0', 'toolPins_64', NULL, 'Internal tool-name reference (num pins -> tool identifier) from the reference source''s own tooling catalog -- low-value naming reference, no known consumer', '{"Num Pins": 64.0, "Tool Name": "toolPins_64"}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

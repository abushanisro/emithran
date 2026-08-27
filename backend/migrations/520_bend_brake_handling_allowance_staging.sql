-- ============================================================================
-- Migration: Bend Brake handling allowance (load + manipulation time) by
--            weight (staging)
-- Purpose: Lands the "smfi_end_brake_handling" export (6 rows: Bend-Brake-
--          specific load_allowance_g + manipulation_allowance_s by weight_kg
--          bracket) into the same lossless staging table earlier migrations
--          created. See migration 479's header for the staging/promotion
--          architecture. No vendor name present in this source file.
--
--          NOTE, flagged not resolved: this row's load_allowance_g sequence
--          (0, 8, 16, 30, 38, 50) is numerically IDENTICAL to migration
--          518's tblMaterialHandlingByWeight "Load Time (s)" column, at the
--          same weight brackets (0/1/5/10/27/unbounded) -- despite the two
--          source screenshots labeling the same numbers as a gram quantity
--          in one place and a time-in-seconds quantity in the other. This
--          looks like a transcription/unit-label inconsistency across two
--          different screenshots of what may be the same underlying default
--          curve, but that is not resolved here -- both are staged exactly
--          as labeled in their own source, and this discrepancy is left for
--          the user to check against the original tool if this data is ever
--          promoted.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'bendBrakeHandling:0.0', '0.0', 'Time', 'Bend-Brake-specific handling allowance (load_allowance_g + manipulation_allowance_s) by part weight bracket -- no known consumer in this app yet', '{"load_allowance_g": 0.0, "manipulation_allowance_s": 0.0, "weight_kg": 0.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeHandling:1.0', '4.0', 'Time', 'Bend-Brake-specific handling allowance (load_allowance_g + manipulation_allowance_s) by part weight bracket -- no known consumer in this app yet', '{"load_allowance_g": 8.0, "manipulation_allowance_s": 4.0, "weight_kg": 1.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeHandling:5.0', '8.0', 'Time', 'Bend-Brake-specific handling allowance (load_allowance_g + manipulation_allowance_s) by part weight bracket -- no known consumer in this app yet', '{"load_allowance_g": 16.0, "manipulation_allowance_s": 8.0, "weight_kg": 5.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeHandling:10.0', '15.0', 'Time', 'Bend-Brake-specific handling allowance (load_allowance_g + manipulation_allowance_s) by part weight bracket -- no known consumer in this app yet', '{"load_allowance_g": 30.0, "manipulation_allowance_s": 15.0, "weight_kg": 10.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeHandling:27.0', '19.0', 'Time', 'Bend-Brake-specific handling allowance (load_allowance_g + manipulation_allowance_s) by part weight bracket -- no known consumer in this app yet', '{"load_allowance_g": 38.0, "manipulation_allowance_s": 19.0, "weight_kg": 27.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeHandling:999999999.0', '25.0', 'Time', 'Bend-Brake-specific handling allowance (load_allowance_g + manipulation_allowance_s) by part weight bracket -- no known consumer in this app yet', '{"load_allowance_g": 50.0, "manipulation_allowance_s": 25.0, "weight_kg": 999999999.0}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

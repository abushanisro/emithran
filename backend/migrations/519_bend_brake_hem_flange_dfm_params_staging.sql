-- ============================================================================
-- Migration: Bend Brake / Press hem & flange DFM parameters (staging)
-- Purpose: Lands the "bend_brake_and_press_parameters" export (21 rows:
--          bendAdviceAngleLimit, bendAdviceFactor, bendFlapLengthMin,
--          deformationsInsideMax, hemDiameterMax, hemReturnFlangeLengthMin,
--          maxBendRadius, rolledHemOpeningMin, teardropHemOpeningMin,
--          returnBendAngleMin/ClockAngleSeparationMax/DistanceMax,
--          teardropHemMaxAngle, uniqueBendRadiiMax -- by operation: Bend
--          Brake / Other / Stamping) into the same lossless staging table
--          earlier migrations created. See migration 479's header for the
--          staging/promotion architecture. No vendor name present in this
--          source file.
--
--          Real corroboration, no code change needed: bendAdviceAngleLimit
--          = 135 exactly matches this app's own SPRINGBACK_COMPOUND check
--          (dfm-scoring.service.ts: bend_angle_deg > 135) -- independent
--          confirmation of an already-sourced threshold.
--
--          Everything else here (hem/flange/flap/deformation parameters) has
--          NO consumer today -- this app's DFM scoring only recognizes
--          'hole' and 'bend' feature types; hemming/flanging isn't detected
--          by the CAD engine (feature_extractors.py) at all. This is the
--          real data behind closeout Plan Phase 5 (hem/flange DFM scoring)
--          -- explicitly the largest, most open-ended phase, gated on a CAD
--          feasibility spike before any engine code is written.
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:bendAdviceAngleLimit', '135.0', NULL, 'Bend/hem/flange DFM parameter (bendAdviceAngleLimit) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "bendAdviceAngleLimit", "value": 135.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:bendAdviceFactor', '2.5', NULL, 'Bend/hem/flange DFM parameter (bendAdviceFactor) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "bendAdviceFactor", "value": 2.5}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:bendFlapLengthMin', '2.5', NULL, 'Bend/hem/flange DFM parameter (bendFlapLengthMin) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "bendFlapLengthMin", "value": 2.5}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:deformationsInsideMax', '3.0', NULL, 'Bend/hem/flange DFM parameter (deformationsInsideMax) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "deformationsInsideMax", "value": 3.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:hemDiameterMax', '1.0', NULL, 'Bend/hem/flange DFM parameter (hemDiameterMax) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "hemDiameterMax", "value": 1.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:hemReturnFlangeLengthMin', '10.0', NULL, 'Bend/hem/flange DFM parameter (hemReturnFlangeLengthMin) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "hemReturnFlangeLengthMin", "value": 10.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:maxBendRadius', '42.0', NULL, 'Bend/hem/flange DFM parameter (maxBendRadius) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "maxBendRadius", "value": 42.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:rolledHemOpeningMin', '1.0', NULL, 'Bend/hem/flange DFM parameter (rolledHemOpeningMin) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "rolledHemOpeningMin", "value": 1.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Bend Brake:teardropHemOpeningMin', '0.25', NULL, 'Bend/hem/flange DFM parameter (teardropHemOpeningMin) for Bend Brake -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Bend Brake", "metric": "teardropHemOpeningMin", "value": 0.25}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:bendFlapLengthMin', '2.0', NULL, 'Bend/hem/flange DFM parameter (bendFlapLengthMin) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "bendFlapLengthMin", "value": 2.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:closedHemDiameterThreshold', '0.1', NULL, 'Bend/hem/flange DFM parameter (closedHemDiameterThreshold) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "closedHemDiameterThreshold", "value": 0.1}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:hemDiameterMax', '1.0', NULL, 'Bend/hem/flange DFM parameter (hemDiameterMax) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "hemDiameterMax", "value": 1.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:hemReturnFlangeLengthMin', '4.0', NULL, 'Bend/hem/flange DFM parameter (hemReturnFlangeLengthMin) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "hemReturnFlangeLengthMin", "value": 4.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:returnBendAngleMin', '90.0', NULL, 'Bend/hem/flange DFM parameter (returnBendAngleMin) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "returnBendAngleMin", "value": 90.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:returnBendClockAngleSeparationMax', '30.0', NULL, 'Bend/hem/flange DFM parameter (returnBendClockAngleSeparationMax) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "returnBendClockAngleSeparationMax", "value": 30.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:returnBendDistanceMax', '1000.0', NULL, 'Bend/hem/flange DFM parameter (returnBendDistanceMax) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "returnBendDistanceMax", "value": 1000.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:rolledHemOpeningMin', '1.0', NULL, 'Bend/hem/flange DFM parameter (rolledHemOpeningMin) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "rolledHemOpeningMin", "value": 1.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:teardropHemMaxAngle', '225.0', NULL, 'Bend/hem/flange DFM parameter (teardropHemMaxAngle) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "teardropHemMaxAngle", "value": 225.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:teardropHemOpeningMin', '0.25', NULL, 'Bend/hem/flange DFM parameter (teardropHemOpeningMin) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "teardropHemOpeningMin", "value": 0.25}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Other:uniqueBendRadiiMax', '1.0', NULL, 'Bend/hem/flange DFM parameter (uniqueBendRadiiMax) for Other -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Other", "metric": "uniqueBendRadiiMax", "value": 1.0}'::jsonb),
('lookup_table', 'USA', '2026-03', 'bendBrakeParam:Stamping:deformationsInsideMax', '3.0', NULL, 'Bend/hem/flange DFM parameter (deformationsInsideMax) for Stamping -- real data behind closeout Plan Phase 5 (hem/flange DFM scoring), not yet built (needs a CAD-feasibility spike first)', '{"operation": "Stamping", "metric": "deformationsInsideMax", "value": 3.0}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

-- ============================================================================
-- Migration: Sheet Metal Lookup Tables -- DFM advice-rule toggle list (staging)
-- Purpose: Lands the Sheet Metal "adviceRules" lookup-table export (70 named
--          DFM advice/check rules, each just a name + enabled flag -- no
--          threshold values in this export) into the same lossless staging
--          table migrations 479/482 created. See migration 479's header for
--          the staging/promotion architecture.
--
--          NOT promoted into dfm_rules_library here -- cross-checking this
--          list against the real DFM pipeline surfaced something bigger than
--          a data gap: this app's live, consumer-facing DFM risk scoring
--          (DFMScoringService, dfm-scoring.service.ts) does NOT read
--          dfm_rules_library at all -- it has its own separate, uncited
--          hardcoded thresholds (e.g. bend-radius crack risk at 0.8x
--          thickness vs dfm_rules_library's stored 1.0x thickness for the
--          same real "Minimum Bend Radius (MS)" rule; flange/edge-to-bend
--          tear risk at 1.0x thickness vs dfm_rules_library's "Minimum
--          Flange Length" at 4.0x thickness -- though these two may address
--          genuinely different failure modes, material-crack vs press-brake
--          clamping, not simply disagree). dfm_rules_library itself was
--          already effectively disconnected from any frontend (part of the
--          broader "Manufacturing Intelligence Platform" module, migration
--          164, with a full CRUD API but zero UI consumers anywhere in this
--          app). This export also has no numeric thresholds to promote even
--          if a live consumer existed -- see project memory
--          project_manufacturing_intelligence_data_reconciliation.md for the
--          full cross-reference and the open decision this surfaces.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'BendAngleCheckAdvice', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BendAngleCheckAdvice", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BendHasGussets', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BendHasGussets", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BendInsideComplexHole', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BendInsideComplexHole", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BendIntersectsBend', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BendIntersectsBend", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BendIntersectsForm', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BendIntersectsForm", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankOverlaps', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BlankOverlaps", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlindHole', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "BlindHole", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckFlatteningAlgorithm', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckFlatteningAlgorithm", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckForStraightWalls', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckForStraightWalls", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckIfCoined', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckIfCoined", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckIfCountersunk', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckIfCountersunk", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckIfFlanged', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckIfFlanged", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckIfHoleThroughMultipleSurfaces', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckIfHoleThroughMultipleSurfaces", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CheckIfNotOrthogonal', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CheckIfNotOrthogonal", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ClosedHem', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ClosedHem", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CoinedHoleDistortion', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CoinedHoleDistortion", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'CustomStockThickness', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "CustomStockThickness", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ExcessiveBendLength', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ExcessiveBendLength", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ExcessiveBendRadius', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ExcessiveBendRadius", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ExcessiveFlangeAngle', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ExcessiveFlangeAngle", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ExcessiveFormDepth', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ExcessiveFormDepth", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ExcessiveFormLength', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ExcessiveFormLength", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ExcessiveHemDirections', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ExcessiveHemDirections", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'FlagFeaturesOutsideManyDeformations', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "FlagFeaturesOutsideManyDeformations", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'FlangedHole', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "FlangedHole", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'FlangedHoleTolerance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "FlangedHoleTolerance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'HemMaxDiameter', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "HemMaxDiameter", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'HemMinDiameter', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "HemMinDiameter", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'HoleToEdgeMessage', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "HoleToEdgeMessage", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientBendFlapLength', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientBendFlapLength", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientBendLength', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientBendLength", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientBendRadius', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientBendRadius", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientBendToFormDistance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientBendToFormDistance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientFlangeGap', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientFlangeGap", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientHemBendFlapLength', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientHemBendFlapLength", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientHoleToBendDistance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientHoleToBendDistance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientHoleToFormDistance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientHoleToFormDistance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientRollBendRadius', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientRollBendRadius", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'InsufficientWallThickness', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "InsufficientWallThickness", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'IntersectsWithAnotherBend', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "IntersectsWithAnotherBend", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'IsHemBend', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "IsHemBend", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'LimitNumUniqueBendRadii', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "LimitNumUniqueBendRadii", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'LimitNumUniqueHoleSizes', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "LimitNumUniqueHoleSizes", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'LowUtilization', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "LowUtilization", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'MaxBendFlapSize', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "MaxBendFlapSize", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'MinRadiusCheck', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "MinRadiusCheck", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'NoToolingAvailable', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "NoToolingAvailable", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ReturnBendCheck', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ReturnBendCheck", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'RolledHemMinRadius', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "RolledHemMinRadius", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'RolledHemOpening', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "RolledHemOpening", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'SmallHoleDiameter', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "SmallHoleDiameter", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'SmallInternalRadius', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "SmallInternalRadius", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TeardropHemMinOpening', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TeardropHemMinOpening", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'ThreadedHole', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "ThreadedHole", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceCircularity', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceCircularity", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceConcentricity', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceConcentricity", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceCoordinateTolerance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceCoordinateTolerance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceCylindricity', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceCylindricity", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceDiamTolerance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceDiamTolerance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceFlatness', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceFlatness", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceParallelism', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceParallelism", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightTolerancePerpendicularity', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightTolerancePerpendicularity", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightTolerancePositionTolerance', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightTolerancePositionTolerance", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceProfileOfSurface', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceProfileOfSurface", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceRoughnessRa', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceRoughnessRa", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceRoughnessRz', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceRoughnessRz", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceRunout', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceRunout", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceStraightness', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceStraightness", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceSymmetry', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceSymmetry", "enabled": true}'::jsonb),
('lookup_table', 'USA', '2026-03', 'TightToleranceTotalRunout', 'true', NULL, 'DFM advice-rule toggle (name + enabled flag only, no threshold in this export)', '{"adviceRuleName": "TightToleranceTotalRunout", "enabled": true}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

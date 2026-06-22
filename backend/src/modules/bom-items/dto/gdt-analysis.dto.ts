import type { GdtSeverity, InspectionMethod, GdtReasonCode } from "../costing/gdt-severity";

export interface GdtFeatureDto {
  type: string;
  toleranceMm: number;
  datum: string;
  confidence: number | null;
  severity: GdtSeverity;
  inspectionMethod: InspectionMethod;
  inspectionTimeMin: number;
  costImpactPercent: number;
  costImpactRange: string;
  reasonCodes: GdtReasonCode[];
  manufacturingActions: string[];
}

export interface GdtAnalysisDto {
  bomItemId: string;
  source: "drawing_intelligence" | "no_data";
  features: GdtFeatureDto[];
  overallSeverity: GdtSeverity | null;
  maxCostImpactPercent: number;
  maxCostImpactRange: string;
  inspectionMethods: InspectionMethod[];
  recommendedInspectionMethod: InspectionMethod | null;
  totalInspectionTimeMin: number;
  analysisConfidence: number;
  generalTolerance: string | null;
}

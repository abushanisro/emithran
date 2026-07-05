import type { ProcessLineCost, RouteResultSustainability } from "./cost-breakdown.dto";
import type { CapabilityReasonCode } from "../costing/machine-capability";

export type RouteId =
  | "sm-laser" | "sm-turret" | "sm-waterjet"
  | "cnc-3ax" | "cnc-4ax" | "cnc-5ax"
  | "cnc-lathe" | "cnc-lathe-lt" | "cnc-mill-turn"
  | "injection-molding";

export interface RouteCapability {
  cuttingCapable: boolean;
  pressBrakeCapable: boolean;
  overallCapable: boolean;
  confidence: "high" | "medium" | "low";
  estimatedTonnage: number | null;
  reasonCodes: CapabilityReasonCode[];
  warnings: string[];
}

export interface RouteResultDto {
  routeId: RouteId;
  routeLabel: string;
  processLines: ProcessLineCost[];
  materialCost: number;
  abrasiveCost: number;
  totalProcessCost: number;
  totalCost: number;
  cycleTimes: {
    cuttingMin: number;
    pressBrakeMin: number;
    tappingMin: number;
    deburrMin: number;
    totalMin: number;
  };
  badges: { lowestCost: boolean; fastest: boolean; bestQuality: boolean };
  capability: RouteCapability;
  warnings: string[];
  ratesSource: string;
  sustainability?: RouteResultSustainability;
  setupCount?: number;
  machineCapabilityWarnings?: string[];
  routeComplexityScore?: number;  // 0–100: holes + pockets + threads + setups + GD&T
}

export interface RouteComparisonDto {
  bomItemId: string;
  batchSize: number;
  materialCost: number;
  materialGrade: string;
  grossWeightKg: number;
  materialCostPerKg: number;
  materialSource: "db" | "default";
  routes: RouteResultDto[];
  comparisonWarnings: string[];
  currency: string;       // ISO 4217 code, e.g. 'USD'
  currencySymbol: string; // display symbol, e.g. '$'
}

import type { ProcessLineCost, RouteResultSustainability } from "./cost-breakdown.dto";
import type { CapabilityReasonCode } from '../costing/shared/capability/machine-capability';

// Was a closed string-literal union of exactly the route ids known at the
// time (3 sheet-metal-cutting + CNC/injection-molding families). Widened to
// `string` so a newly-registered ManufacturingProcessEngine's route id (see
// manufacturing-process-registry.ts's ROUTE_ID_FOR_CLASS) is valid here with
// no edit to this file — validation that a given id is actually real/offered
// happens at the call sites that build/consume it (getRouteComparison's
// registry+catalog gate, apply-route.dto.ts's VALID_ROUTE_IDS), not via the
// type system pretending to enumerate every route id that will ever exist.
export type RouteId = string;

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
  totalCost: number | null;  // null when isFeasible === false — prevents sort/ML pollution
  isFeasible: boolean;       // false when the machine cannot physically produce this part
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
  currency: string;       // ISO 4217 code of the CURRENT display currency, e.g. 'USD'
  currencySymbol: string; // display symbol for `currency`, e.g. '$'
  toUsdRate?: number;     // amount_local × toUsdRate = amount in `currency` — see normalizeRouteComparisonToCurrency
  usdToDisplayRate?: number; // amount_usd × usdToDisplayRate = amount in `currency` — see cost-breakdown.dto.ts's own doc comment for why this differs from toUsdRate
}

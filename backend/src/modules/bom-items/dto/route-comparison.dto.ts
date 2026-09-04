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
  // Which real registered-engine family produced this route
  // (manufacturing-process-registry.ts's getEnginesForFamily bucket) —
  // 'cutting' routes (Laser/Turret/Waterjet/Shear/Plasma/OxyFuel/Router) are
  // mutually-exclusive alternatives for the SAME cut+bend+deburr+inspect
  // chain; 'forming' routes (Standard/Tandem/Progressive-Die Press, Roll
  // Bending) are complete, structurally different single-process
  // alternatives with no separate Press Brake/Deburr step of their own.
  // Consumers that pick ONE cutting method (the Workflow Builder's cutting
  // row) must filter to 'cutting' — mixing both families into one
  // mutually-exclusive picker previously showed forming routes as if they
  // were cutting alternatives, which they structurally are not.
  processFamily: 'cutting' | 'forming';
  // Real, database-driven tooling-economics signal — set ONLY for the 2
  // forming classes that have a real, sourced annual-volume threshold in
  // sm_reference_data (category='variable', migration 479):
  // progressive_die_press (key='progDieAnnualVolumeLimit') and tandem_press
  // (key='stageToolingAnnualVolumeLimit' — "stage tooling" is the real
  // reference-data term for Tandem Press's hard tooling, confirmed via
  // migration 500/609's processDefaultMachine:Tandem Press -> tool_shop_name
  // 'StageDiemaker1'). null for every other route — standard_press/roll_
  // bending/all cutting classes have no such sourced threshold, and none is
  // fabricated for them. Compares the part's real, already-resolved
  // annualVolume against the real threshold and states the real relationship
  // in each direction; never hides or reorders the route based on this.
  toolingVolumeNote: string | null;
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

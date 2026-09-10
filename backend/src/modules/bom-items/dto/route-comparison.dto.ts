import type { ProcessLineCost, ResolvedCostingInputsDto, RouteResultSustainability } from "./cost-breakdown.dto";
import type { CapabilityReasonCode } from '../costing/shared/capability/machine-capability';
import type { RouteDataGap } from '../costing/shared/core/engine-kernel';

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

/**
 * Real, per-part injection-molding clamp/shot sizing detail behind an IM
 * tonnage-tier route — the actual numbers evaluateIMCandidate() computed for
 * THIS part against the tier's real (or, absent a DB machine, synthetic)
 * machine, not just the pass/fail RouteCapability above. Set only on the 3
 * real injection_molding tonnage-tier routes (small/medium/large) — the
 * clamp-tonnage/shot-capacity constraint model doesn't apply to Compression/
 * Reaction Injection/Structural Foam Molding, so those routes leave this
 * unset rather than fabricate a clamp number for a press that isn't clamped
 * the same way.
 */
export interface RouteInjectionMoldingDetail {
  /** Required clamp force for this part (projected area × cavities × material factor × 1.15 margin), metric tons-force. */
  clampRequiredT: number | null;
  /** The evaluated machine's real clamp rating (DB machine) or the tier's synthetic fallback tonnage. */
  clampMachineT: number | null;
  /** clampRequiredT / clampMachineT as a 0-100 percentage. null when projected area is unknown. */
  clampUtilPct: number | null;
  /** Required shot weight for this part (part + runner) × cavities × 1.10 margin, grams. */
  shotRequiredG: number | null;
  /** The evaluated machine's real shot capacity, grams. null when the machine has no shot-capacity figure on file. */
  shotMachineG: number | null;
  /** shotRequiredG / shotMachineG as a 0-100 percentage. null when shotMachineG is unknown. */
  shotUtilPct: number | null;
  /** Real cavity count this route was costed at (recommendCavityCount, constrained by clamp/shot/economics). */
  cavityCount: number;
  /** Real gate-type recommendation (recommendGateType) driving cycle time / trimming for this route. */
  gateType: string;
  /** Whether this DB machine's clamp/shot data came from imported reference data or a class-tier synthetic fallback. */
  machineDataSource: 'imported' | 'synthetic';
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
  /**
   * False when this route's own process has no blank-generation operation in
   * the seeded catalog taxonomy — today only 2/3/4 Roll Bending, whose
   * operations are StraightBend / Form / As Formed//CurvedSurface / As
   * Formed//CurvedWall / Coil Uncoil and never //Blank. Such a route is priced
   * over a smaller scope of work than the routes beside it (it carries no
   * blanking cost at all), so it is excluded from the recommendation and from
   * the badges while staying fully visible and manually selectable.
   *
   * Optional: only the sheet-metal comparison resolves it. CNC and
   * injection-molding routes have no blanking concept and leave it unset,
   * which every consumer must read as "no evidence against this route".
   */
  producesBlank?: boolean;
  /**
   * False when an operation on this route has no real costing data on file, so
   * its price is an artefact of absent data rather than an economic result.
   *
   * Deliberately separate from `isFeasible`, which means physical capability:
   * a Tandem Press may be entirely capable of this part while having no
   * press_cycle_time_s on file for the selected machine. The route stays
   * visible with its warnings intact; it is only barred from winning a badge or
   * an automatic selection. Computed with the SAME predicate apply-route
   * enforces before persisting (isRouteDataComplete, engine-kernel.ts), so any
   * route Auto can pick is a route apply-route will accept.
   */
  dataComplete: boolean;
  /** The specific missing-data reasons behind `dataComplete: false`. Empty when complete. */
  dataGaps: RouteDataGap[];
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
  /** Real clamp-tonnage/shot-capacity sizing detail — set only on IM tonnage-tier routes. See RouteInjectionMoldingDetail. */
  injectionMolding?: RouteInjectionMoldingDetail;
}

export interface RouteComparisonDto {
  bomItemId: string;
  batchSize: number;
  /**
   * The route this comparison recommends: the cheapest candidate that is both
   * physically capable and fully costed — the same rule behind the "Lowest
   * cost" badge, stated once so automatic routing and the badge cannot
   * disagree. `null` when no candidate qualifies, which callers must treat as
   * "no recommendation" rather than picking something.
   *
   * Automatic route selection consumes this. Manual selection does not: a route
   * the user chose is never replaced by it. See selectRecommendedRoute().
   */
  recommendedRouteId: RouteId | null;
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

/**
 * What the route-comparison endpoint returns. Separate from RouteComparisonDto
 * for the same reason CostSummaryResponseDto is separate from CostSummaryDto:
 * only the entry point that resolved the inputs can state them.
 */
export interface RouteComparisonResponseDto extends RouteComparisonDto {
  resolvedInputs: ResolvedCostingInputsDto;
}

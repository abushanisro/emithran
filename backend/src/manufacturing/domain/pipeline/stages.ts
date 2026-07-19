/**
 * Pipeline stage result types.
 *
 * Every stage in the Manufacturing Pipeline produces an immutable result that
 * becomes the next stage's input. No stage mutates a previous result.
 *
 * Stage order:
 *   ManufacturingIR
 *     → PlanningResult       (which operations to run, candidate routes)
 *     → CapabilityResult     (which routes are physically feasible)
 *     → RuleResult           (resolved cutting parameters per operation)
 *     → CalculationResult    (cycle times + full trace per operation)
 *     → ValidationResult     (manufacturability gate)
 *     → CostResult           (aggregated cost, ready for DB persistence)
 */

import type { ManufacturingIR, Feature } from '../ir/manufacturing-ir';
import type { ResolvedMachiningParams, CalculatorResult, TraceStep } from '../interfaces/process-calculator.interface';

// ── Shared ────────────────────────────────────────────────────────────────────
export type PipelineStage =
  | 'planning'
  | 'capability'
  | 'rule_evaluation'
  | 'calculation'
  | 'validation'
  | 'cost_aggregation';

export interface Diagnostic {
  readonly stage: PipelineStage;
  readonly level: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  readonly appliesTo?: string; // featureId or operationId
}

// ── Stage 1: Planning ─────────────────────────────────────────────────────────
// Determines which operations are needed and which routes are candidates.

export type OperationType =
  | 'laser_cutting'
  | 'turret_punch'
  | 'waterjet'
  | 'press_brake'
  | 'drilling'
  | 'tapping'
  | 'milling'
  | 'turning'
  | 'mill_turn'
  | 'injection_molding'
  | 'deburring'
  | 'inspection';

export interface PlannedOperation {
  readonly operationId: string;
  readonly type: OperationType;
  /** featureIds this operation applies to. Empty = part-level operation. */
  readonly featureIds: readonly string[];
  readonly sequenceIndex: number;
  readonly processGroup: string; // 'Sheet Metal' | 'CNC Machining' | 'Plastics' | 'Quality'
}

export interface CandidateRoute {
  readonly routeId: string;
  readonly routeLabel: string;
  readonly operationIds: readonly string[];
}

export interface PlanningResult {
  readonly ir: ManufacturingIR;
  readonly operations: readonly PlannedOperation[];
  readonly candidateRoutes: readonly CandidateRoute[];
  readonly diagnostics: readonly Diagnostic[];
}

// ── Stage 2: Capability ───────────────────────────────────────────────────────
// Checks machine physical constraints against part geometry.

export interface CapabilityConstraint {
  readonly constraintType: string;   // 'max_sheet_thickness' | 'press_tonnage' | 'travel'
  readonly requiredValue: number;
  readonly availableValue: number;
  readonly unit: string;
}

export interface FeasibleRoute {
  readonly routeId: string;
  readonly routeLabel: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly constraintsSatisfied: readonly CapabilityConstraint[];
}

export interface InfeasibleRoute {
  readonly routeId: string;
  readonly routeLabel: string;
  readonly blockedBy: readonly CapabilityConstraint[];
  readonly reason: string;
}

export interface CapabilityResult {
  readonly planning: PlanningResult;
  readonly feasibleRoutes: readonly FeasibleRoute[];
  readonly infeasibleRoutes: readonly InfeasibleRoute[];
  readonly diagnostics: readonly Diagnostic[];
}

// ── Stage 3: Rule Evaluation ──────────────────────────────────────────────────
// Resolves ISO cutting parameters for each planned operation.

export interface AppliedRule {
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly standardRef: string;   // 'ISO 513:2012 Table 3'
  readonly condition: string;     // human-readable: "ISO P material, hole.d < 12mm"
  readonly outcome: string;       // "Vc=120, feed=0.18, tool=Carbide"
}

export interface RuleResult {
  readonly capability: CapabilityResult;
  /** Keyed by operationId from PlanningResult. */
  readonly resolvedParams: ReadonlyMap<string, ResolvedMachiningParams>;
  readonly appliedRules: readonly AppliedRule[];
  readonly diagnostics: readonly Diagnostic[];
}

// ── Stage 4: Calculation ──────────────────────────────────────────────────────
// Runs the calculator plugin for each operation, with full trace.

export interface CalculatedOperation {
  readonly operationId: string;
  readonly type: OperationType;
  readonly feature: Feature;
  readonly cycleTimeSec: number;
  readonly machineRequirements: CalculatorResult['machineRequirements'];
  readonly toolRequirements: CalculatorResult['toolRequirements'];
  readonly trace: readonly TraceStep[];
  readonly validation: CalculatorResult['validation'];
}

export interface CalculationResult {
  readonly rules: RuleResult;
  readonly calculatedOps: readonly CalculatedOperation[];
  readonly diagnostics: readonly Diagnostic[];
}

// ── Stage 5: Validation ───────────────────────────────────────────────────────
// Manufacturability gate — raises blockers before any cost is computed.

export type ManufacturabilityIssueSeverity = 'error' | 'warning' | 'info';

export interface ManufacturabilityIssue {
  readonly severity: ManufacturabilityIssueSeverity;
  readonly code: string;           // 'POCKET_DEPTH_EXCEEDS_TOOL_RATIO'
  readonly message: string;        // "Pocket depth 30mm exceeds 5× tool diameter (12mm)"
  readonly suggestion?: string;    // "Use long-reach end mill or reduce depth to 20mm"
  readonly appliesTo: string;      // featureId or 'part'
}

export interface ValidationResult {
  readonly calculation: CalculationResult;
  readonly isManufacturable: boolean;
  readonly issues: readonly ManufacturabilityIssue[];
  readonly diagnostics: readonly Diagnostic[];
}

// ── Stage 6: Cost Aggregation ─────────────────────────────────────────────────
// Computes the final cost breakdown, ready for persistence.

export interface CostComponent {
  readonly label: string;
  readonly costLocal: number;
  readonly currency: string;
  readonly currencySymbol: string;
  readonly pctOfTotal: number;
}

export interface ProcessCostLine {
  readonly operationId: string;
  readonly type: OperationType;
  readonly processGroup: string;
  readonly machineName: string | null;
  readonly machineClass: string;
  readonly machineRatePerHr: number;   // INR/hr (or local currency)
  readonly cycleTimeSec: number;
  readonly setupTimeSec: number;
  readonly cycleRunCost: number;       // machineRatePerHr × (cycleTimeSec / 3600)
  readonly setupCost: number;          // amortised over batchSize
  readonly totalLineCost: number;      // cycleRunCost + setupCost
  readonly currency: string;
  readonly trace: readonly TraceStep[];
}

export interface CostTrace {
  readonly materialCost: CostComponent;
  readonly processLines: readonly ProcessCostLine[];
  readonly allDiagnostics: readonly Diagnostic[];
}

export interface CostResult {
  readonly validation: ValidationResult;
  readonly materialCost: number;
  readonly processCost: number;
  readonly totalCost: number;
  readonly currency: string;
  readonly currencySymbol: string;
  readonly processLines: readonly ProcessCostLine[];
  readonly trace: CostTrace;
  readonly diagnostics: readonly Diagnostic[];
}

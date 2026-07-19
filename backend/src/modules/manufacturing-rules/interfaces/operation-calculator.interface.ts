// ── ISO 513:2004 material group codes ────────────────────────────────────────
export type IsoGroup = 'P' | 'M' | 'K' | 'N' | 'S' | 'H';

export type QualityLevel = 'roughing' | 'semi_finishing' | 'finishing';

export type ToolMaterial = 'hss' | 'hss_cobalt' | 'carbide' | 'ceramic' | 'cbn' | 'pcd';

// ── Resolved parameters from machining_parameters table ──────────────────────
export interface MachiningParams {
  isoGroup: IsoGroup;
  vcRecommended: number;       // m/min cutting speed
  feedRecommended: number;     // mm/rev (turning/drilling) or mm/tooth (milling)
  apMaxMm: number;             // depth of cut max, mm
  aePctMax?: number;           // radial engagement % of D (milling only)
  toolMaterial: ToolMaterial;
  insertGradeIso: string;      // e.g. 'P25-P40'
  insertCoating: string;       // e.g. 'CVD TiCN/Al2O3'
  toolLifeMinutes?: number;
  toolLifeHoles?: number;
  parameterSource: string;     // citation
}

// ── Per-step audit entry for explainable output ───────────────────────────────
export interface CalculationStep {
  stepName: string;            // 'rpm', 'approach_distance', 'cycle_time_per_hole'
  expression: string;          // '(1000 * Vc) / (PI * D)'
  inputs: Record<string, number>;
  result: number;
  units: string;
}

// ── Calculator output ─────────────────────────────────────────────────────────
export interface CalculationResult {
  totalCycleTimeSec: number;
  perFeatureCycleTimeSec: number;
  featureCount: number;
  steps: CalculationStep[];
}

// ── Validation ────────────────────────────────────────────────────────────────
export interface ValidationResult {
  valid: boolean;
  errors: string[];    // physics violations → reject
  warnings: string[];  // degraded tool life, peck drilling needed, etc.
}

// ── Machine selection hints after cycle time calculation ─────────────────────
export interface MachineRequirements {
  minPowerKw: number;
  minRpm: number;
  minTravelMm?: number;
  minClampingKn?: number;      // injection molding
  machineCategoryHint: string;
}

// ── Tool requirements for tool planning ──────────────────────────────────────
export interface ToolRequirements {
  toolType: string;            // 'solid_carbide_drill', 'hss_twist_drill', etc.
  diameterMm?: number;
  coating: string;
  insertGradeIso: string;
}

// ── Base geometry — extended by each calculator's specific geometry type ──────
export interface FeatureGeometry {
  [key: string]: unknown;
}

// ── The plugin contract ───────────────────────────────────────────────────────
export interface IOperationCalculator {
  readonly operationKey: string;

  validate(params: MachiningParams, geometry: FeatureGeometry): ValidationResult;

  calculate(params: MachiningParams, geometry: FeatureGeometry): CalculationResult | Promise<CalculationResult>;

  machineRequirements(params: MachiningParams, result: CalculationResult): MachineRequirements;

  toolRequirements(params: MachiningParams, geometry: FeatureGeometry): ToolRequirements;
}

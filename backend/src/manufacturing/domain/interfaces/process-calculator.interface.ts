/**
 * ProcessCalculator — the plugin contract every manufacturing process must implement.
 *
 * Every new process (Wire EDM, Additive, Casting) is a class that implements
 * this interface. No changes needed anywhere else in the pipeline.
 *
 * Rules:
 *   1. Calculators are pure functions of their inputs — no DB calls, no HTTP.
 *   2. Every calculation emits a full trace so engineers can audit every number.
 *   3. Validation is always separate from calculation.
 *   4. supports() is evaluated by the dispatcher; implement it narrowly.
 */

import type { Feature, ManufacturingIR } from '../ir/manufacturing-ir';

// ── Trace (Rule #7: every number must be explainable) ────────────────────────
export interface TraceStep {
  readonly step: string;
  readonly formula?: string;
  readonly inputs?: Readonly<Record<string, number | string>>;
  readonly result: number | string;
  readonly unit?: string;
  readonly standardRef?: string; // ISO 513, Rosato cooling formula, etc.
}

// ── Validation result ─────────────────────────────────────────────────────────
export interface CalculatorValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];   // physics violations — must fix
  readonly warnings: readonly string[]; // degraded performance but still calculable
}

// ── Calculator input (what gets passed from the pipeline) ────────────────────
export interface CalculatorInput {
  readonly ir: ManufacturingIR;
  readonly feature: Feature;
  readonly resolvedParams: ResolvedMachiningParams;
}

// ── Resolved machining parameters (from Rule + Parameter resolution stages) ──
export interface ResolvedMachiningParams {
  readonly Vc: number;           // cutting speed m/min
  readonly feed: number;         // mm/rev (drilling/turning) | mm/tooth (milling)
  readonly apMaxMm: number;      // axial depth of cut mm
  readonly aePctMax?: number;    // radial engagement % (milling)
  readonly toolMaterial: string; // 'carbide' | 'hss' | 'cbn' | 'pcd'
  readonly insertGradeISO: string;
  readonly insertCoating: string;
  readonly toolLifeMinutes?: number;
  readonly toolLifeHoles?: number;
  readonly parameterSource: string;
  readonly ruleId: string;
  readonly standardRef: string;
}

// ── Machine requirements (output to machine selector) ────────────────────────
export interface MachineRequirements {
  readonly minPowerKw: number;
  readonly minRpm: number;
  readonly minTravelMm?: number;
  readonly minClampingKn?: number;
  readonly machineCategoryHint: string; // 'vmc_3ax' | 'fiber_laser' | 'press_brake' | …
}

// ── Tool requirements ─────────────────────────────────────────────────────────
export interface ToolRequirements {
  readonly toolType: string;
  readonly diameterMm?: number;
  readonly coating: string;
  readonly insertGradeISO: string;
}

// ── Calculator result ─────────────────────────────────────────────────────────
export interface CalculatorResult {
  /** Cycle time for the feature instance, in seconds. */
  readonly cycleTimeSec: number;
  /** Breakdown per feature if count > 1 (e.g. per-hole time). */
  readonly perInstanceSec?: number;
  /** Number of feature instances this result covers. */
  readonly featureCount: number;
  /** Full audit trail — every formula, every intermediate value. */
  readonly trace: readonly TraceStep[];
  readonly machineRequirements: MachineRequirements;
  readonly toolRequirements: ToolRequirements;
  readonly validation: CalculatorValidation;
}

// ── The plugin contract ───────────────────────────────────────────────────────
export interface ProcessCalculator {
  /**
   * Canonical name used in the registry.
   * Must be a stable snake_case string — this is stored in the DB.
   */
  readonly operationKey: string;

  /**
   * Returns true when this calculator can handle the given IR + feature
   * combination. The dispatcher calls this for each registered calculator.
   */
  supports(ir: ManufacturingIR, feature: Feature): boolean;

  /**
   * Validates that the feature geometry is physically plausible for this
   * operation. Called before calculate(); if !valid, calculate() is not called.
   */
  validate(input: CalculatorInput): CalculatorValidation;

  /**
   * Compute cycle time, trace, machine requirements, and tool requirements.
   * Must be deterministic: same inputs → same outputs every time.
   * Must not access the database, filesystem, or network.
   */
  calculate(input: CalculatorInput): CalculatorResult | Promise<CalculatorResult>;
}

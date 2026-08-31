import { LASER_SETUP_MIN } from "./default-rates";
import type { MHRRateInput } from "./cost-engine";
import type { ProcessLineCost, PhysicsGap, ConfidenceLevel } from "../dto/cost-breakdown.dto";
import type { CuttingProcessContext, CuttingProcessResult } from "./manufacturing-process-engine";
import { noRateFallback, computeDirectLaborCost } from "./engine-kernel";
import { BaseCuttingEngine, buildCuttingProcessLine } from "./engine-orchestrator";

export interface LaserCuttingInput {
  cutLengthMm: number;
  pierceCount: number;
  batchSize: number;
  grade: string | null;
  laserRate?: MHRRateInput;
  sheetThicknessMm: number;
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Sheet Metal - Laser Cutting Manufacturing" DB calculator ONLY, via
  // the caller's resolvePhysicsQuantity (bom-items.service.ts) — the same
  // shared evaluator getCostSummary uses, so route comparison and the cost
  // summary can never silently disagree. Undefined (never a fallback number)
  // when the calculator couldn't resolve one — `physicsGap` then carries the
  // real, structured reason (missing lookup row, or no calculator at all).
  cuttingSecFromCalculator?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  physicsGap?: PhysicsGap | null;
  confidence?: ConfidenceLevel;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) — never
  // hardcoded here. Absent means the caller couldn't resolve one; consumers must
  // not fabricate processGroup/processRoute/operation in that case.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Per-batch setup time (min) — resolved by the caller from
  // sm_lookup_op_setup_time (migration 416) via getOpSetupTime('laser').
  setupMin?: number;
}

export interface LaserCuttingResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  warnings: string[];
}

export function computeLaserCuttingCost(input: LaserCuttingInput): LaserCuttingResult {
  const warnings: string[] = [];
  if (input.cutLengthMm <= 0 && input.pierceCount <= 0) {
    return { processLines: [], cuttingMin: 0, warnings };
  }

  let totalLaserSec: number;
  if (typeof input.cuttingSecFromCalculator === 'number' && Number.isFinite(input.cuttingSecFromCalculator)) {
    totalLaserSec = input.cuttingSecFromCalculator;
  } else if (input.physicsGap) {
    const gap = input.physicsGap;
    warnings.push(gap.gapType === 'missing_lookup'
      ? `Laser cutting cycle time unavailable — ${gap.requiredAction}`
      : `Laser cutting cycle time unavailable — ${gap.reason}`);
    totalLaserSec = 0;
  } else {
    // Defensive: resolvePhysicsQuantity always returns either a value or a
    // gap — reaching here means a bug in that resolver, not a data gap.
    warnings.push('Laser cutting cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    totalLaserSec = 0;
  }
  const cuttingMin = totalLaserSec / 60;
  const rate = input.laserRate ?? noRateFallback("fiber_laser");
  if (input.setupMin == null) {
    warnings.push("Laser: setup time from fallback — seed sm_lookup_op_setup_time for 'laser'");
  }
  const setupMin = input.setupMin ?? LASER_SETUP_MIN;

  // Direct-labor cost — Track B Phase 1 bug fix: waterjet/turret both charge
  // one operator's direct labor here (rate.labourRate × time); laser never
  // did, an unintended divergence with no physical justification (laser
  // needs no less operator attention than waterjet/turret) predating this
  // redesign. Now consistent across all three via the shared kernel helper.
  const labor = computeDirectLaborCost(rate, setupMin, cuttingMin, input.batchSize, "Laser", warnings);
  const setupCost = (setupMin / 60) * rate.rate / Math.max(input.batchSize, 1) + labor.setupLaborCost;
  const runCost   = (totalLaserSec / 3600) * rate.rate + labor.runLaborCost;

  return {
    processLines: [
      buildCuttingProcessLine({
        process: "Laser Cutting",
        processIdentity: input.processIdentity,
        setupCost,
        runCost,
        cycleTimeMin: cuttingMin,
        rate,
        extra: {
          labourRate: rate.labourRate ?? null,
          ...(input.calculatorId ? { calculatorId: input.calculatorId } : {}),
          ...(input.calculatorVersion != null ? { calculatorVersion: input.calculatorVersion } : {}),
          ...(input.physicsGap ? { physicsGap: input.physicsGap } : {}),
          ...(input.confidence ? { confidence: input.confidence } : {}),
        },
      }),
    ],
    cuttingMin,
    warnings,
  };
}

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts.
export class LaserCuttingEngine extends BaseCuttingEngine {
  readonly machineClass = 'fiber_laser';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    const result = computeLaserCuttingCost({
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      grade: context.grade,
      laserRate: context.rate,
      sheetThicknessMm: context.sheetThicknessMm,
      cuttingSecFromCalculator: context.cuttingSecFromCalculator,
      calculatorId: context.calculatorId,
      calculatorVersion: context.calculatorVersion,
      physicsGap: context.physicsGap,
      confidence: context.confidence,
      processIdentity: context.processIdentity,
      setupMin: context.opSetupMin,
    });
    return { ...result, abrasiveCost: 0 };
  }
}

// Same real cost formula, same "Laser Cutting" process, different real
// machine technology (CO2 discharge oscillator, e.g. AMADA Quattro — see
// default-rates.ts's co2_laser registry entry for why this is a genuinely
// separate class from fiber_laser, not a keyword variant of it).
// computeLaserCuttingCost itself has no fiber-vs-CO2 assumption baked in —
// it takes whatever cuttingSecFromCalculator the caller's resolvePhysicsQuantity
// resolved (or the real, structured physicsGap when it didn't), so this
// engine's only job is to exist as a real, registered candidate for
// machine-selection/route-comparison to find a co2_laser-classed machine
// through — never a second cost formula.
export class Co2LaserCuttingEngine extends BaseCuttingEngine {
  readonly machineClass = 'co2_laser';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    const result = computeLaserCuttingCost({
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      grade: context.grade,
      laserRate: context.rate,
      sheetThicknessMm: context.sheetThicknessMm,
      cuttingSecFromCalculator: context.cuttingSecFromCalculator,
      calculatorId: context.calculatorId,
      calculatorVersion: context.calculatorVersion,
      physicsGap: context.physicsGap,
      confidence: context.confidence,
      processIdentity: context.processIdentity,
      setupMin: context.opSetupMin,
    });
    return { ...result, abrasiveCost: 0 };
  }
}

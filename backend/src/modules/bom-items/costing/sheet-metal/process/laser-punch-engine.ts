import { LASER_PUNCH_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface LaserPunchInput {
  pierceCount: number;   // total punched holes
  holeCount: number;     // unique hole diameters -> one tool change each
  cutLengthMm: number;   // contour length to nibble
  batchSize: number;
  laserPunchRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real, per-SELECTED-MACHINE punch/nibble physics from sm_reference_data's
  // 'laserPunchMachine:*' rows (migration 2026-09-01), resolved by the
  // caller via SheetMetalLookupService.getLaserPunchMachineParams(). See
  // manufacturing-process-engine.ts's LaserPunchParams doc comment for the
  // nibbleMmPerMin derivation. Missing real data means an honest $0/0-min
  // punch+nibble line, never a guess.
  punchRateCyclesPerMin?: number;
  nibbleMmPerMin?: number;
  toolChangeSec?: number;
  // Per-batch setup time (min) — resolved by the caller from
  // sm_lookup_op_setup_time via SheetMetalLookupService.getOpSetupTime
  // ('laser_punch'). Falls back to LASER_PUNCH_SETUP_MIN with a disclosed
  // warning when no row is seeded yet — same convention as every other
  // cutting engine's setupMin.
  setupMin?: number;
  dlrPerHr?: number;
  qairPerHr?: number;
  inspTimeMin?: number;
  samplingRate?: number;
  yieldPct?: number;
  netMatCost?: number;
  netWeightKg?: number;
  scrapPricePerKg?: number;
}

export interface LaserPunchResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — laser punching has no abrasive consumable. Kept only so this
  // result shape satisfies the shared CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computeLaserPunchCost(input: LaserPunchInput): LaserPunchResult {
  const warnings: string[] = [];
  const rate = input.laserPunchRate ?? noRateFallback("laser_punch");

  const hasRealParams = input.punchRateCyclesPerMin != null && input.nibbleMmPerMin != null && input.toolChangeSec != null;
  if (!hasRealParams && (input.pierceCount > 0 || input.cutLengthMm > 0)) {
    warnings.push(
      `Laser Punch: no real punch/nibble-rate data on file for ${rate.machineName ?? "the selected machine"} (sm_reference_data 'laserPunchMachine:*') — punch/nibble time is $0 until real data is added for it, not an estimate`,
    );
  }

  const punchingSec = hasRealParams && input.pierceCount > 0
    ? (input.pierceCount / input.punchRateCyclesPerMin!) * 60
    : 0;
  const toolChangeSec = hasRealParams
    ? (input.holeCount * input.toolChangeSec!) / Math.max(input.batchSize, 1)
    : 0;
  const nibblingSec = hasRealParams && input.cutLengthMm > 0
    ? (input.cutLengthMm / input.nibbleMmPerMin!) * 60
    : 0;

  const cuttingMin = (punchingSec + toolChangeSec + nibblingSec) / 60;

  if (input.setupMin == null) {
    warnings.push("Laser Punch: setup time from fallback — seed sm_lookup_op_setup_time for 'laser_punch'");
  }
  const setupMin = input.setupMin ?? LASER_PUNCH_SETUP_MIN;

  const t = eMithranTerms({
    mhrPerHr: rate.rate,
    dlrPerHr: rate.labourRate ?? input.dlrPerHr ?? 0,
    qairPerHr: input.qairPerHr ?? 0,
    setupNDL: rate.operators ?? 1,
    cycleNDL: rate.operators ?? 1,
    cycleTimeMin: cuttingMin,
    setupTimeMin: setupMin / Math.max(input.batchSize, 1),
    inspTimeMin: input.inspTimeMin ?? 0,
    samplingRate: input.samplingRate ?? 0,
    yieldPct: input.yieldPct ?? DEFAULT_YIELD_PCT,
    netMatCost: input.netMatCost ?? 0,
    netWeightKg: input.netWeightKg ?? 0,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  const processLines: ProcessLineCost[] = [
    buildCuttingProcessLine({
      process: "Laser Punch",
      processIdentity: input.processIdentity,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cuttingMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null },
    }),
  ];

  return { processLines, cuttingMin, abrasiveCost: 0, warnings };
}

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts. machine_class
// 'laser_punch' is wired to the 26 real machines in machine_library.json's
// "Laser Punch / Punch Press" category (2026-09-01) — a genuinely distinct
// combo laser+punch machine pool from turret_punch (no name overlap).
export class LaserPunchEngine extends BaseCuttingEngine {
  readonly machineClass = 'laser_punch';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computeLaserPunchCost({
      pierceCount: context.pierceCount,
      holeCount: context.holeCount,
      cutLengthMm: context.cutLengthMm,
      batchSize: context.batchSize,
      laserPunchRate: context.rate,
      processIdentity: context.processIdentity,
      setupMin: context.opSetupMin,
      dlrPerHr: context.dlrPerHr,
      qairPerHr: context.qairPerHr,
      inspTimeMin: context.inspTimeMin,
      samplingRate: context.samplingRate,
      yieldPct: context.yieldPct,
      netMatCost: context.netMatCost,
      netWeightKg: context.netWeightKg,
      scrapPricePerKg: context.scrapPricePerKg,
      ...(context.laserPunchParams?.dataFound ? {
        punchRateCyclesPerMin: context.laserPunchParams.punchRateCyclesPerMin,
        nibbleMmPerMin: context.laserPunchParams.nibbleMmPerMin,
        toolChangeSec: context.laserPunchParams.toolChangeSec,
      } : {}),
    });
  }
}

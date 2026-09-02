import { PLASMA_PUNCH_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

// Despite the "Punch" name, the only real data available for this class is a
// feed-rate/pierce-time cutting model (sm_reference_data 'nestingCutRate:*:
// PlasmaPunch:*', 139 rows) keyed by material+thickness+power — identical in
// shape to Plasma Cut/OxyFuel Cut. These are plasma torches mounted on
// punch-press-style machines, not discrete-cycle punches like Laser Punch's
// real punch_rate_cycles_min/nibble_rate_cycles_min data. No punch-cycle
// data exists for this class anywhere in the sourced reference data, so this
// engine is deliberately NOT modeled like LaserPunchEngine — the real data
// available determines the model, not the taxonomy name.
export interface PlasmaPunchInput {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;
  batchSize: number;
  plasmaPunchRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  feedRateLargeFeaturesMmPerMin?: number;
  pierceTimeSec?: number;
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

export interface PlasmaPunchResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — no abrasive/nozzle-wear rate table exists for this class yet.
  // Kept only so this result shape satisfies the shared
  // CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computePlasmaPunchCost(input: PlasmaPunchInput): PlasmaPunchResult {
  const warnings: string[] = [];
  const rate = input.plasmaPunchRate ?? noRateFallback('plasma_punch');

  let cuttingSec = 0;
  let pierceSec = 0;
  if (input.feedRateLargeFeaturesMmPerMin != null && input.pierceTimeSec != null) {
    cuttingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin) * 60 : 0;
    pierceSec = input.pierceCount * input.pierceTimeSec;
  } else if (input.cutLengthMm > 0 || input.pierceCount > 0) {
    warnings.push(
      "Plasma Punch: no real feed-rate/pierce-time data for this machine/material/thickness (sm_reference_data 'nestingCutRate:*:PlasmaPunch:*') — cutting/pierce time is $0 until real data is added for it, not an estimate",
    );
  }
  const cuttingMin = (cuttingSec + pierceSec) / 60;

  if (input.setupMin == null) {
    warnings.push("Plasma Punch: setup time from fallback — seed sm_lookup_op_setup_time for 'plasma_punch'");
  }
  const setupMin = input.setupMin ?? PLASMA_PUNCH_SETUP_MIN;

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
      process: 'Plasma Punch',
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
// 'plasma_punch' is wired to the 12 real machines in machine_library.json's
// "Plasma Punch" category (2026-09-01).
export class PlasmaPunchEngine extends BaseCuttingEngine {
  readonly machineClass = 'plasma_punch';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computePlasmaPunchCost({
      sheetThicknessMm: context.sheetThicknessMm,
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      plasmaPunchRate: context.rate,
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
      ...(context.plasmaPunchParams?.dataFound ? {
        feedRateLargeFeaturesMmPerMin: context.plasmaPunchParams.feedRateLargeFeaturesMmPerMin,
        pierceTimeSec: context.plasmaPunchParams.pierceTimeSec,
      } : {}),
    });
  }
}

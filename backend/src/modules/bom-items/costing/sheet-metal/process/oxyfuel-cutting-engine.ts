import { OXYFUEL_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface OxyfuelInput {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number; // contour/hole starts
  batchSize: number;
  oxyfuelRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real, material+thickness-specific feed rate/pierce time from
  // sm_reference_data's 'nestingCutRate:*:OxyFuelCut:*' rows (migration 492),
  // resolved by the caller via SheetMetalLookupService.getOxyfuelParams().
  // Only the large-feature (profile) feed rate is used — see
  // OxyfuelParams' own doc comment (manufacturing-process-engine.ts) for
  // why the source's small-feature rate is deliberately not applied here
  // yet. Missing real data (material/thickness not covered by the 278
  // staged rows) means an honest $0/0-min cutting line, never a guess.
  feedRateLargeFeaturesMmPerMin?: number;
  pierceTimeSec?: number;
  // Per-batch setup time — resolved by the caller from
  // sm_lookup_op_setup_time via SheetMetalLookupService.getOpSetupTime
  // ('oxyfuel_cut'). Falls back to OXYFUEL_SETUP_MIN when no row is seeded
  // yet, with a disclosed warning — same convention as every other cutting
  // engine's setupMin.
  setupMin?: number;
  // eMithranTerms() inputs — see CuttingProcessContext's own doc comment for
  // sourcing.
  dlrPerHr?: number;
  qairPerHr?: number;
  inspTimeMin?: number;
  samplingRate?: number;
  yieldPct?: number;
  netMatCost?: number;
  netWeightKg?: number;
  scrapPricePerKg?: number;
}

export interface OxyfuelResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — oxyfuel cutting (oxygen + fuel gas combustion) has no
  // abrasive consumable like waterjet's garnet. Kept only so this result
  // shape satisfies the shared CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computeOxyfuelCost(input: OxyfuelInput): OxyfuelResult {
  const warnings: string[] = [];
  const rate = input.oxyfuelRate ?? noRateFallback("oxyfuel_cut");

  // No hardcoded feed-rate/pierce-time table here — see OxyfuelInput's doc
  // comment. Missing real data means an honest $0/0-min cutting line, not
  // an estimate.
  let cuttingSec = 0;
  let pierceSec = 0;
  if (input.feedRateLargeFeaturesMmPerMin != null && input.pierceTimeSec != null) {
    cuttingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin) * 60 : 0;
    pierceSec = input.pierceCount * input.pierceTimeSec;
  } else if (input.cutLengthMm > 0 || input.pierceCount > 0) {
    warnings.push(
      "OxyFuel Cut: no real feed-rate/pierce-time data for this material/thickness (sm_reference_data 'nestingCutRate:*:OxyFuelCut:*') — cutting/pierce time is $0 until real data is added for it, not an estimate",
    );
  }
  const cuttingMin = (cuttingSec + pierceSec) / 60;

  if (input.setupMin == null) {
    warnings.push("OxyFuel Cut: setup time from fallback — seed sm_lookup_op_setup_time for 'oxyfuel_cut'");
  }
  const setupMin = input.setupMin ?? OXYFUEL_SETUP_MIN;

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
      process: "OxyFuel Cut",
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
// 'oxyfuel_cut' is wired to the 18 real machines in machine_library.json's
// "Oxyfuel Cutting Machine" category (2026-09-01) — no contamination issue
// like Progressive/Standard/Tandem Press had, since Oxyfuel is not a
// shared category with any other press/cutting family.
export class OxyfuelCuttingEngine extends BaseCuttingEngine {
  readonly machineClass = 'oxyfuel_cut';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computeOxyfuelCost({
      sheetThicknessMm: context.sheetThicknessMm,
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      oxyfuelRate: context.rate,
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
      ...(context.oxyfuelParams?.dataFound ? {
        feedRateLargeFeaturesMmPerMin: context.oxyfuelParams.feedRateLargeFeaturesMmPerMin,
        pierceTimeSec: context.oxyfuelParams.pierceTimeSec,
      } : {}),
    });
  }
}

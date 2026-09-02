import { PLASMA_CUT_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface PlasmaCutInput {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number; // contour/hole starts
  batchSize: number;
  plasmaCutRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real, material+thickness+POWER-specific feed rate/pierce time from
  // sm_reference_data's 'nestingCutRate:*:PlasmaCut:*' rows, resolved by the
  // caller via SheetMetalLookupService.getPlasmaCutParams() — which itself
  // first resolves the SELECTED machine's own real power_watts (real power
  // varies 100W-100,000W across the 13 real machines, unlike OxyFuel's
  // uniform 200W). Only the large-feature (profile) feed rate is used — see
  // PlasmaCutParams' own doc comment for why the source's small-feature
  // rate is deliberately not applied here yet. Missing real data means an
  // honest $0/0-min cutting line, never a guess.
  feedRateLargeFeaturesMmPerMin?: number;
  pierceTimeSec?: number;
  // Per-batch setup time — resolved by the caller from
  // sm_lookup_op_setup_time via SheetMetalLookupService.getOpSetupTime
  // ('plasma_cut'). Falls back to PLASMA_CUT_SETUP_MIN when no row is
  // seeded yet, with a disclosed warning — same convention as every other
  // cutting engine's setupMin.
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

export interface PlasmaCutResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — plasma cutting's real consumable is the nozzle/electrode
  // (nozzle_cost_usd/nozzle_life_cycles exist per-machine in
  // machine_library.json), not an abrasive like waterjet's garnet. No
  // sm_waterjet_nozzle_rates-equivalent table exists for plasma yet — a
  // disclosed scoping gap, not modeled here, kept only so this result shape
  // satisfies the shared CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computePlasmaCutCost(input: PlasmaCutInput): PlasmaCutResult {
  const warnings: string[] = [];
  const rate = input.plasmaCutRate ?? noRateFallback('plasma_cut');

  let cuttingSec = 0;
  let pierceSec = 0;
  if (input.feedRateLargeFeaturesMmPerMin != null && input.pierceTimeSec != null) {
    cuttingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / input.feedRateLargeFeaturesMmPerMin) * 60 : 0;
    pierceSec = input.pierceCount * input.pierceTimeSec;
  } else if (input.cutLengthMm > 0 || input.pierceCount > 0) {
    warnings.push(
      "Plasma Cut: no real feed-rate/pierce-time data for this machine/material/thickness (sm_reference_data 'nestingCutRate:*:PlasmaCut:*') — cutting/pierce time is $0 until real data is added for it, not an estimate",
    );
  }
  const cuttingMin = (cuttingSec + pierceSec) / 60;

  if (input.setupMin == null) {
    warnings.push("Plasma Cut: setup time from fallback — seed sm_lookup_op_setup_time for 'plasma_cut'");
  }
  const setupMin = input.setupMin ?? PLASMA_CUT_SETUP_MIN;

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
      process: 'Plasma Cut',
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
// 'plasma_cut' is wired to the 13 real machines in machine_library.json's
// "Plasma Cutting Machine" category (2026-09-01), previously carrying a
// phantom machine_class='plasma' on all 65 live mhr_records rows.
export class PlasmaCuttingEngine extends BaseCuttingEngine {
  readonly machineClass = 'plasma_cut';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computePlasmaCutCost({
      sheetThicknessMm: context.sheetThicknessMm,
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      plasmaCutRate: context.rate,
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
      ...(context.plasmaCutParams?.dataFound ? {
        feedRateLargeFeaturesMmPerMin: context.plasmaCutParams.feedRateLargeFeaturesMmPerMin,
        pierceTimeSec: context.plasmaCutParams.pierceTimeSec,
      } : {}),
    });
  }
}

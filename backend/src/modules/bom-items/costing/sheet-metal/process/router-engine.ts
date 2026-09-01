import { ROUTER_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface RouterInput {
  cutLengthMm: number;
  pierceCount: number;
  batchSize: number;
  routerRate?: MHRRateInput;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) —
  // never hardcoded here.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real material-family cutting speed from sm_lookup_router_cut
  // (Track B Phase 2, tblRouterUtilities.json), resolved by the caller via
  // SheetMetalLookupService.getRouterParams(). That source has real data
  // ONLY for Aluminum/Copper — absent for any other material family (or a
  // thickness/grade that hasn't been classified) means an honest $0/0-min
  // cutting line, not a guess. The source also has no plunge/pierce-time
  // data at all — pierceCount is disclosed via a warning, never given a
  // fabricated per-plunge time.
  cuttingSpeedMmPerMin?: number;
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

export interface RouterResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — routing has no abrasive consumable. Kept only so this result
  // shape satisfies the shared CuttingProcessResult contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computeRouterCost(input: RouterInput): RouterResult {
  const warnings: string[] = [];
  const rate = input.routerRate ?? noRateFallback("router_2axis");

  let cuttingMin = 0;
  if (input.cuttingSpeedMmPerMin != null && input.cutLengthMm > 0) {
    cuttingMin = input.cutLengthMm / input.cuttingSpeedMmPerMin;
  } else if (input.cutLengthMm > 0) {
    warnings.push("2-Axis Router: no sm_lookup_router_cut entry for this material family — cutting time is $0 until real data is added for it, not an estimate");
  }
  if (input.pierceCount > 0) {
    warnings.push("2-Axis Router: plunge/pierce time is not modeled — no real plunge-time data on file, so only linear cutting time is charged");
  }

  if (input.setupMin == null) {
    warnings.push("2-Axis Router: setup time from fallback — seed sm_lookup_op_setup_time for 'router_2axis'");
  }
  const setupMin = input.setupMin ?? ROUTER_SETUP_MIN;

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
      process: "Router Cutting",
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
// registered in manufacturing-process-registry.ts.
export class RouterEngine extends BaseCuttingEngine {
  readonly machineClass = 'router_2axis';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computeRouterCost({
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      routerRate: context.rate,
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
      ...(context.routerParams?.dataFound ? {
        cuttingSpeedMmPerMin: context.routerParams.cuttingSpeedMmPerMin,
      } : {}),
    });
  }
}

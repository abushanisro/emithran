import {
  WATERJET_SETUP_MIN,
  WATERJET_ABRASIVE_KG_PER_MIN,
  WATERJET_LEAD_IN_MM,
  WATERJET_CUT_TIME_ADJUSTMENT_FACTOR,
  DEFAULT_YIELD_PCT,
} from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { r2, noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface WaterjetInput {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;  // contour starts
  batchSize: number;
  waterjetRate?: MHRRateInput;
  // Garnet price in the SAME currency as waterjetRate.rate.
  // Resolved from consumable_prices DB table (migration 362) by the service.
  // When null/absent, abrasive cost is 0 — user must add data to consumable_prices.
  abrasivePricePerKg?: number;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) — never
  // hardcoded here. Absent means the caller couldn't resolve one; consumers must
  // not fabricate processGroup/processRoute/operation in that case.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real, material+thickness-specific cutting speed/pierce time from
  // sm_lookup_waterjet_cut (migration 398), resolved by the caller via
  // SheetMetalLookupService.getWaterjetParams() — same pattern as laser's
  // rcLaserParams in bom-items.service.ts. This function stays a pure,
  // synchronous calculation; it never queries the DB itself and has NO
  // hardcoded speed/pierce-time table of its own to fall back to. When the
  // caller has no real data (material grade not yet set, or genuinely no
  // sm_lookup_waterjet_cut row for this material/thickness), cutting/pierce
  // time are honestly 0 with a warning — never an invented number.
  cuttingSpeedMmPerMin?: number;
  pierceTimeSec?: number;
  // Real garnet consumption rate (kg/min of ACTIVE cutting time) for this
  // shop's pump/orifice tier — resolved by the caller from
  // sm_lookup_waterjet_abrasive_rate (migration 413) via
  // SheetMetalLookupService.getWaterjetAbrasiveRate(). Falls back to
  // WATERJET_ABRASIVE_KG_PER_MIN (a real, cited machine-tier default — see
  // that constant's own comment — not an invented number) when no row is
  // seeded yet, with a disclosed warning, same convention as
  // cuttingSpeedMmPerMin/pierceTimeSec above.
  abrasiveKgPerMin?: number;
  // Per-batch setup time (min) — resolved by the caller from
  // sm_lookup_op_setup_time (migration 416) via
  // SheetMetalLookupService.getOpSetupTime('waterjet'). Falls back to
  // WATERJET_SETUP_MIN when no row is seeded yet, with a disclosed warning.
  setupMin?: number;
  // Real nozzle-wear cost/hr — see manufacturing-process-engine.ts's
  // CuttingProcessContext for sourcing (migration 531, closeout Plan
  // Phase 2b).
  nozzleRate?: { costPerHr: number; dataFound: boolean };
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

export interface WaterjetResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  abrasiveCost: number;  // same currency as the machine rate / abrasivePricePerKg
  warnings: string[];
}

export function computeWaterjetCost(input: WaterjetInput): WaterjetResult {
  const warnings: string[] = [];
  if (input.sheetThicknessMm === 0) warnings.push("Waterjet: thickness 0 — cutting speed lookup cannot resolve without a real thickness");

  const rate = input.waterjetRate ?? noRateFallback("waterjet");

  // No hardcoded speed/pierce-time table here — see WaterjetInput's doc comment.
  // Missing real data means an honest $0/0-sec cutting line, not a guess.
  let cuttingSec = 0;
  let pierceSec = 0;
  if (input.cuttingSpeedMmPerMin != null && input.pierceTimeSec != null) {
    // Each contour start (pierceCount) needs an entry ramp-up and a mirrored
    // exit ramp-down — real travel at cutting speed, not "useful" cut length.
    // See WATERJET_LEAD_IN_MM's own comment for the physical justification.
    const effectiveCutLengthMm = input.cutLengthMm > 0
      ? input.cutLengthMm + input.pierceCount * 2 * WATERJET_LEAD_IN_MM
      : 0;
    const rawCuttingSec = effectiveCutLengthMm > 0 ? (effectiveCutLengthMm / input.cuttingSpeedMmPerMin) * 60 : 0;
    // Acceleration/deceleration overhead beyond the lead-in distance itself —
    // see WATERJET_CUT_TIME_ADJUSTMENT_FACTOR's own comment.
    cuttingSec = rawCuttingSec * WATERJET_CUT_TIME_ADJUSTMENT_FACTOR;
    pierceSec = input.pierceCount * input.pierceTimeSec;
  } else if (input.cutLengthMm > 0 || input.pierceCount > 0) {
    warnings.push("Waterjet: no sm_lookup_waterjet_cut entry for this material/thickness — cutting/pierce time is $0 until real data is added for it, not an estimate");
  }
  const totalSec = cuttingSec + pierceSec;
  const cuttingMin = totalSec / 60;

  // Abrasive charged only for active cutting time, not piercing
  const abrasivePricePerKg = input.abrasivePricePerKg ?? 0;
  if (input.abrasiveKgPerMin == null && cuttingSec > 0) {
    warnings.push("Waterjet: abrasive consumption rate from fallback — seed sm_lookup_waterjet_abrasive_rate for this pump tier");
  }
  const abrasiveKgPerMin = input.abrasiveKgPerMin ?? WATERJET_ABRASIVE_KG_PER_MIN;
  const abrasiveCost = r2(
    (cuttingSec / 60) * abrasiveKgPerMin * abrasivePricePerKg,
  );

  if (input.setupMin == null) {
    warnings.push("Waterjet: setup time from fallback — seed sm_lookup_op_setup_time for 'waterjet'");
  }
  const setupMin = input.setupMin ?? WATERJET_SETUP_MIN;

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
      process: "Waterjet Cutting",
      processIdentity: input.processIdentity,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cuttingMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null },
    }),
  ];

  // Real nozzle-wear cost, charged only for active cutting time (same basis
  // as abrasive cost above) — see migration 531 (closeout Plan Phase 2b). A
  // distinct, visible line item, never charged when no rate is seeded.
  if (input.nozzleRate?.dataFound && cuttingSec > 0) {
    const nozzleCost = r2((cuttingSec / 3600) * input.nozzleRate.costPerHr);
    processLines.push({
      process: "Nozzle Wear",
      setupCost: 0,
      runCost: nozzleCost,
      totalCost: nozzleCost,
      cycleTimeMin: 0,
      hourlyRate: 0,
      rateSource: "default_rate",
      machineClass: rate.machineClass,
      machineName: null,
      commodityCode: null,
    });
  } else if (cuttingSec > 0) {
    warnings.push("Waterjet: no nozzle-wear rate seeded — nozzle cost excluded from quote");
  }

  return {
    processLines,
    cuttingMin,
    abrasiveCost,
    warnings,
  };
}

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts.
export class WaterjetEngine extends BaseCuttingEngine {
  readonly machineClass = 'waterjet';
  readonly processFamily = 'sheet_metal_cutting';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computeWaterjetCost({
      sheetThicknessMm: context.sheetThicknessMm,
      cutLengthMm: context.cutLengthMm,
      pierceCount: context.pierceCount,
      batchSize: context.batchSize,
      waterjetRate: context.rate,
      abrasivePricePerKg: context.abrasivePricePerKg,
      abrasiveKgPerMin: context.abrasiveKgPerMin,
      setupMin: context.opSetupMin,
      nozzleRate: context.nozzleRate,
      processIdentity: context.processIdentity,
      dlrPerHr: context.dlrPerHr,
      qairPerHr: context.qairPerHr,
      inspTimeMin: context.inspTimeMin,
      samplingRate: context.samplingRate,
      yieldPct: context.yieldPct,
      netMatCost: context.netMatCost,
      netWeightKg: context.netWeightKg,
      scrapPricePerKg: context.scrapPricePerKg,
      ...(context.waterjetParams?.dataFound ? {
        cuttingSpeedMmPerMin: context.waterjetParams.cuttingSpeedMmPerMin,
        pierceTimeSec: context.waterjetParams.pierceTimeMin * 60,
      } : {}),
    });
  }
}

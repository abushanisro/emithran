import {
  WATERJET_SETUP_MIN,
  WATERJET_ABRASIVE_KG_PER_MIN,
} from "./default-rates";
import type { MHRRateInput } from "./cost-engine";
import type { ProcessLineCost } from "../dto/cost-breakdown.dto";
import type { CapabilityCheck, PartGeometryForCapability } from "./machine-capability";
import { checkMachineCapability } from "./machine-capability";
import type { ManufacturingProcessEngine, CuttingProcessContext, CuttingProcessResult } from "./manufacturing-process-engine";

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

  const rate = input.waterjetRate ?? { rate: 0, source: "no_db_rate" as const, machineClass: "waterjet", machineName: null, commodityCode: null };

  // No hardcoded speed/pierce-time table here — see WaterjetInput's doc comment.
  // Missing real data means an honest $0/0-sec cutting line, not a guess.
  let cuttingSec = 0;
  let pierceSec = 0;
  if (input.cuttingSpeedMmPerMin != null && input.pierceTimeSec != null) {
    cuttingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / input.cuttingSpeedMmPerMin) * 60 : 0;
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
  const setupCost = r2((setupMin / 60) * rate.rate / Math.max(input.batchSize, 1));
  const runCost = r2((totalSec / 3600) * rate.rate);

  return {
    processLines: [
      {
        process: "Waterjet Cutting",
        ...(input.processIdentity ? {
          processGroup: input.processIdentity.processGroup,
          processRoute: input.processIdentity.processRoute,
          operation: input.processIdentity.operation,
        } : {}),
        setupCost,
        runCost,
        totalCost: r2(setupCost + runCost),
        cycleTimeMin: r2(cuttingMin),
        hourlyRate: rate.rate,
        rateSource: rate.source,
        machineClass: rate.machineClass,
        machineName: rate.machineName,
        commodityCode: rate.commodityCode,
        labourRate: rate.labourRate ?? null,
      },
    ],
    cuttingMin,
    abrasiveCost,
    warnings,
  };
}

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts.
export class WaterjetEngine implements ManufacturingProcessEngine {
  readonly machineClass = 'waterjet';
  readonly processFamily = 'sheet_metal_cutting';

  checkCapability(geometry: PartGeometryForCapability, commodityCode: string | null): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry);
  }

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
      processIdentity: context.processIdentity,
      ...(context.waterjetParams?.dataFound ? {
        cuttingSpeedMmPerMin: context.waterjetParams.cuttingSpeedMmPerMin,
        pierceTimeSec: context.waterjetParams.pierceTimeMin * 60,
      } : {}),
    });
  }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

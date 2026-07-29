import {
  WATERJET_SETUP_MIN,
  WATERJET_PIERCE_SEC,
  WATERJET_SPEED_MM_PER_MIN,
  WATERJET_ABRASIVE_KG_PER_MIN,
} from "./default-rates";
import type { MHRRateInput } from "./cost-engine";
import type { ProcessLineCost } from "../dto/cost-breakdown.dto";

export interface WaterjetInput {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;  // contour starts; 5 sec each (waterjet pierces in motion)
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
}

export interface WaterjetResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  abrasiveCost: number;  // same currency as the machine rate / abrasivePricePerKg
  warnings: string[];
}

export function computeWaterjetCost(input: WaterjetInput): WaterjetResult {
  const warnings: string[] = [];
  const thk = input.sheetThicknessMm > 0 ? input.sheetThicknessMm : 2.0;
  if (input.sheetThicknessMm === 0) warnings.push("Waterjet: thickness 0 — defaulting to 2.0 mm");

  const rate = input.waterjetRate ?? { rate: 0, source: "no_db_rate" as const, machineClass: "waterjet", machineName: null, commodityCode: null };

  const speedMmMin = nearestVal(thk, WATERJET_SPEED_MM_PER_MIN);
  const cuttingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / speedMmMin) * 60 : 0;
  const pierceSec = input.pierceCount * WATERJET_PIERCE_SEC;
  const totalSec = cuttingSec + pierceSec;
  const cuttingMin = totalSec / 60;

  // Abrasive charged only for active cutting time, not piercing
  const abrasivePricePerKg = input.abrasivePricePerKg ?? 0;
  const abrasiveCost = r2(
    (cuttingSec / 60) * WATERJET_ABRASIVE_KG_PER_MIN * abrasivePricePerKg,
  );

  const setupCost = r2((WATERJET_SETUP_MIN / 60) * rate.rate / Math.max(input.batchSize, 1));
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

function nearestVal(mm: number, table: Record<number, number>): number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (Math.abs(k - mm) < Math.abs(best - mm)) best = k;
  }
  return table[best];
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

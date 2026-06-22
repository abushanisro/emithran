import {
  TURRET_MHR_INR,
  TURRET_SETUP_MIN,
  TURRET_TOOL_CHANGE_SEC,
  TURRET_HITS_PER_MIN,
  TURRET_NIBBLE_MM_PER_MIN,
} from "./default-rates";
import type { MHRRateInput } from "./cost-engine";
import type { ProcessLineCost } from "../dto/cost-breakdown.dto";

export interface TurretPunchInput {
  sheetThicknessMm: number;
  pierceCount: number;   // total punched holes
  holeCount: number;     // unique hole diameters → one tool change each
  cutLengthMm: number;   // contour length to nibble
  batchSize: number;
  turretRate?: MHRRateInput;
}

export interface TurretPunchResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  warnings: string[];
}

export function computeTurretPunchCost(input: TurretPunchInput): TurretPunchResult {
  const warnings: string[] = [];
  const thk = input.sheetThicknessMm > 0 ? input.sheetThicknessMm : 2.0;
  if (input.sheetThicknessMm === 0) warnings.push("Turret: thickness 0 — defaulting to 2.0 mm");
  if (thk > 6) warnings.push(`Turret: ${thk}mm exceeds typical turret punch range (≤6 mm)`);

  const rate = input.turretRate ?? { rate: TURRET_MHR_INR, source: "default_rate" as const, machineClass: "turret_punch", machineName: null, commodityCode: null };

  // Punching hits
  const hitsPerMin = nearestVal(thk, TURRET_HITS_PER_MIN);
  const punchingSec = input.pierceCount > 0 ? (input.pierceCount / hitsPerMin) * 60 : 0;

  // Tool change penalty — amortised over batchSize
  const toolChangeSec =
    (input.holeCount * TURRET_TOOL_CHANGE_SEC) / Math.max(input.batchSize, 1);

  // Nibbling for contour cuts
  const nibbleSpeed = nearestVal(thk, TURRET_NIBBLE_MM_PER_MIN);
  const nibblingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / nibbleSpeed) * 60 : 0;
  if (input.cutLengthMm > 0)
    warnings.push("Turret: contour assumed nibbled — actual method depends on tooling setup");

  const totalSec = punchingSec + toolChangeSec + nibblingSec;
  const cuttingMin = totalSec / 60;
  const setupCost = r2((TURRET_SETUP_MIN / 60) * rate.rate / Math.max(input.batchSize, 1));
  const runCost = r2((totalSec / 3600) * rate.rate);

  return {
    processLines: [
      {
        process: "Turret Punching",
        setupCost,
        runCost,
        totalCost: r2(setupCost + runCost),
        cycleTimeMin: r2(cuttingMin),
        hourlyRate: rate.rate,
        rateSource: rate.source,
        machineClass: rate.machineClass,
        machineName: rate.machineName,
        commodityCode: rate.commodityCode,
      },
    ],
    cuttingMin,
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

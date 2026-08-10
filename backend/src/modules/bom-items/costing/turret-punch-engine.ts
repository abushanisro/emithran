import {
  TURRET_SETUP_MIN,
  TURRET_TOOL_CHANGE_SEC,
  TURRET_HITS_PER_MIN,
  TURRET_NIBBLE_MM_PER_MIN,
} from "./default-rates";
import type { MHRRateInput } from "./cost-engine";
import type { ProcessLineCost } from "../dto/cost-breakdown.dto";
import type { CapabilityCheck, PartGeometryForCapability } from "./machine-capability";
import { checkMachineCapability } from "./machine-capability";
import type { ManufacturingProcessEngine, CuttingProcessContext, CuttingProcessResult, TurretParams } from "./manufacturing-process-engine";

export interface TurretPunchInput {
  sheetThicknessMm: number;
  pierceCount: number;   // total punched holes
  holeCount: number;     // unique hole diameters → one tool change each
  cutLengthMm: number;   // contour length to nibble
  batchSize: number;
  turretRate?: MHRRateInput;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) — never
  // hardcoded here. Absent means the caller couldn't resolve one; consumers must
  // not fabricate processGroup/processRoute/operation in that case.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real, thickness-specific hits/min, nibble speed, and tool-change time from
  // sm_lookup_turret_punch (migration 414), resolved by the caller via
  // SheetMetalLookupService.getTurretPunchParams() — same disclosed-fallback
  // pattern as laser's/waterjet's own params. Falls back to the module-level
  // TURRET_HITS_PER_MIN/TURRET_NIBBLE_MM_PER_MIN/TURRET_TOOL_CHANGE_SEC tables
  // when the caller has no real DB data (dataFound: false), with a warning.
  turretParams?: TurretParams | null;
  // Per-batch setup time (min) — resolved by the caller from
  // sm_lookup_op_setup_time (migration 416) via getOpSetupTime('turret_punch').
  setupMin?: number;
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

  const rate = input.turretRate ?? { rate: 0, source: "no_db_rate" as const, machineClass: "turret_punch", machineName: null, commodityCode: null };

  if (!input.turretParams?.dataFound) {
    warnings.push("Turret: cycle-time params from fallback table — seed sm_lookup_turret_punch for this thickness");
  }
  const hitsPerMin = input.turretParams?.dataFound ? input.turretParams.hitsPerMin : nearestVal(thk, TURRET_HITS_PER_MIN);
  const nibbleSpeed = input.turretParams?.dataFound ? input.turretParams.nibbleMmPerMin : nearestVal(thk, TURRET_NIBBLE_MM_PER_MIN);
  const toolChangeSecPerHole = input.turretParams?.dataFound ? input.turretParams.toolChangeSec : TURRET_TOOL_CHANGE_SEC;

  // Punching hits
  const punchingSec = input.pierceCount > 0 ? (input.pierceCount / hitsPerMin) * 60 : 0;

  // Tool change penalty — amortised over batchSize
  const toolChangeSec = (input.holeCount * toolChangeSecPerHole) / Math.max(input.batchSize, 1);

  // Nibbling for contour cuts
  const nibblingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / nibbleSpeed) * 60 : 0;
  if (input.cutLengthMm > 0)
    warnings.push("Turret: contour assumed nibbled — actual method depends on tooling setup");

  const totalSec = punchingSec + toolChangeSec + nibblingSec;
  const cuttingMin = totalSec / 60;
  if (input.setupMin == null) {
    warnings.push("Turret: setup time from fallback — seed sm_lookup_op_setup_time for 'turret_punch'");
  }
  const setupMin = input.setupMin ?? TURRET_SETUP_MIN;
  const setupCost = r2((setupMin / 60) * rate.rate / Math.max(input.batchSize, 1));
  const runCost = r2((totalSec / 3600) * rate.rate);

  return {
    processLines: [
      {
        process: "Turret Punching",
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

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts.
export class TurretPunchEngine implements ManufacturingProcessEngine {
  readonly machineClass = 'turret_punch';
  readonly processFamily = 'sheet_metal_cutting';

  checkCapability(geometry: PartGeometryForCapability, commodityCode: string | null): CapabilityCheck {
    return checkMachineCapability(this.machineClass, commodityCode, geometry);
  }

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    const result = computeTurretPunchCost({
      sheetThicknessMm: context.sheetThicknessMm,
      pierceCount: context.pierceCount,
      holeCount: context.holeCount,
      cutLengthMm: context.cutLengthMm,
      batchSize: context.batchSize,
      turretRate: context.rate,
      processIdentity: context.processIdentity,
      turretParams: context.turretParams,
      setupMin: context.opSetupMin,
    });
    return { ...result, abrasiveCost: 0 };
  }
}

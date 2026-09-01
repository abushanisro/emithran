import {
  TURRET_SETUP_MIN,
  TURRET_TOOL_CHANGE_SEC,
  TURRET_HITS_PER_MIN,
  TURRET_NIBBLE_MM_PER_MIN,
  DEFAULT_YIELD_PCT,
} from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult, TurretParams } from '../../shared/core/manufacturing-process.types';
import { r2, noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

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
  // Real part weight (kg) and handling-allowance rate — see
  // manufacturing-process-engine.ts's CuttingProcessContext for sourcing.
  partWeightKg?: number;
  handlingAllowance?: { allowanceUsd: number; dataFound: boolean };
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

  const rate = input.turretRate ?? noRateFallback("turret_punch");

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
      process: "Turret Punching",
      processIdentity: input.processIdentity,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cuttingMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null },
    }),
  ];

  // Real material-handling allowance by part weight — see migration 530
  // (closeout Plan Phase 2a). A distinct, visible line item rather than
  // folded into runCost/setupCost — never charged when no rate is seeded
  // for this machine class (never guessed) or when part weight is unknown.
  if (input.handlingAllowance?.dataFound && input.partWeightKg != null && input.partWeightKg >= 0) {
    const handlingCost = r2(input.handlingAllowance.allowanceUsd);
    processLines.push({
      process: "Material Handling",
      setupCost: 0,
      runCost: handlingCost,
      totalCost: handlingCost,
      cycleTimeMin: 0,
      hourlyRate: 0,
      rateSource: "default_rate",
      machineClass: rate.machineClass,
      machineName: null,
      commodityCode: null,
    });
  } else if (input.partWeightKg != null) {
    warnings.push("Turret: no material-handling-allowance rate seeded for this machine class — handling cost excluded from quote");
  }

  return {
    processLines,
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

// Thin ManufacturingProcessEngine wrapper around the real formula above —
// registered in manufacturing-process-registry.ts.
export class TurretPunchEngine extends BaseCuttingEngine {
  readonly machineClass = 'turret_punch';
  readonly processFamily = 'sheet_metal_cutting';

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
      partWeightKg: context.partWeightKg,
      handlingAllowance: context.handlingAllowance,
      dlrPerHr: context.dlrPerHr,
      qairPerHr: context.qairPerHr,
      inspTimeMin: context.inspTimeMin,
      samplingRate: context.samplingRate,
      yieldPct: context.yieldPct,
      netMatCost: context.netMatCost,
      netWeightKg: context.netWeightKg,
      scrapPricePerKg: context.scrapPricePerKg,
    });
    return { ...result, abrasiveCost: 0 };
  }
}

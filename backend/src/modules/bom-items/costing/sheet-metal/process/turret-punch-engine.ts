import {
  TURRET_SETUP_MIN,
  TURRET_TOOL_CHANGE_SEC,
  DEFAULT_YIELD_PCT,
} from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult, TurretPunchMachineParams } from '../../shared/core/manufacturing-process.types';
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
  // Real per-SELECTED-MACHINE nibble speed + tool-change time (2026-09-02),
  // resolved by the caller via
  // SheetMetalLookupService.getTurretPunchMachineParams() — see that
  // method's own doc comment. No real punch/hit-rate data exists for this
  // class (verified against the full field-name union of all 21 real
  // machines); punching costs an honest $0 with a disclosed warning when
  // pierceCount > 0, never a guess.
  turretMachineParams?: TurretPunchMachineParams | null;
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

  // Punching: no real per-machine punch/hit-rate data exists anywhere in the
  // source for this class (verified against the full field-name union of
  // all 21 real Turret Press machines) — an honest $0, never a guess.
  const punchingSec = 0;
  if (input.pierceCount > 0) {
    warnings.push("Turret: no real punch/hit-rate data exists for this machine class — punching time is $0 until real data is sourced, not an estimate");
  }

  const toolChangeSecPerHole = input.turretMachineParams?.dataFound ? input.turretMachineParams.toolChangeSec : TURRET_TOOL_CHANGE_SEC;
  if (!input.turretMachineParams?.dataFound && input.holeCount > 0) {
    warnings.push("Turret: tool-change time from fallback — seed sm_reference_data 'turretPunchMachine:<name>' for the selected machine");
  }
  // Tool change penalty — amortised over batchSize
  const toolChangeSec = (input.holeCount * toolChangeSecPerHole) / Math.max(input.batchSize, 1);

  // Nibbling for contour cuts — real per-machine nibble speed (derived from
  // nibble_rate_cycles_min × step-per-cycle geometry), same resolution shape
  // as Laser Punch. Honest $0 when no real row resolves for this machine.
  let nibblingSec = 0;
  if (input.turretMachineParams?.dataFound) {
    nibblingSec = input.cutLengthMm > 0 ? (input.cutLengthMm / input.turretMachineParams.nibbleMmPerMin) * 60 : 0;
    if (input.cutLengthMm > 0) {
      warnings.push("Turret: contour assumed nibbled — actual method depends on tooling setup");
    }
  } else if (input.cutLengthMm > 0) {
    warnings.push("Turret: no real nibble-rate data on file for this machine — nibbling time is $0 until real data is sourced, not an estimate");
  }

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
      turretMachineParams: context.turretPunchMachineParams,
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

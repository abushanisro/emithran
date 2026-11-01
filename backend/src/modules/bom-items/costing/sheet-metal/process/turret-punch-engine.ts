import {
  resolveYieldPct,
} from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ConfidenceLevel, PhysicsGap, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult, TurretPunchMachineParams } from '../../shared/core/manufacturing-process.types';
import { r2, noRateFallback, eMithranTerms, resolveSetupMinutes } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface TurretPunchInput {
  sheetThicknessMm: number;
  pierceCount: number;   // total punched holes
  cutLengthMm: number;   // contour length to nibble
  batchSize: number;
  turretRate?: MHRRateInput;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) — never
  // hardcoded here. Absent means the caller couldn't resolve one; consumers must
  // not fabricate processGroup/processRoute/operation in that case.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Cycle time comes from the "Sheet Metal - TPP Manufacturing" DB calculator
  // ONLY (punching + tool changes + nibbling, see migration 904), resolved by the
  // caller's resolvePhysicsQuantity, so the quote and the interactive Cycle Time
  // calculator can never disagree. Undefined when it could not resolve one;
  // `physicsGap` then carries the reason.
  cuttingSecFromCalculator?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  physicsGap?: PhysicsGap | null;
  confidence?: ConfidenceLevel;
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

interface TurretPunchResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  warnings: string[];
}

/**
 * Tool changes of a turret part: one per distinct punched hole diameter (holes of one diameter
 * share a tool). Diameters are compared to 0.01 mm, the resolution of the CAD feature ids.
 * Null when the analysis recorded no hole diameters.
 */
export function distinctHoleDiameterCount(diametersMm: readonly number[] | null | undefined): number | null {
  const valid = (diametersMm ?? []).filter((d) => Number.isFinite(d) && d > 0);
  return valid.length === 0 ? null : new Set(valid.map((d) => d.toFixed(2))).size;
}

/**
 * Why the TPP calculator cannot be seeded for this machine, or null when every
 * machine input is on file. With no machine there is nothing to read a rate from:
 * that is a selection result (no turret meets the part's force or size need), not
 * missing reference data.
 */
export function turretMissingInputs(machineName: string | null | undefined, mp: TurretPunchMachineParams | null | undefined): string | null {
  if (!machineName) {
    return 'no turret machine could be selected for this part, so there is no machine rate to read; see the capability warning for the force and size that ruled every machine out';
  }
  if (!mp?.dataFound) {
    return `no nibble rate or tool-change time for ${machineName}: sm_reference_data 'turretPunchMachine:<name>' missing`;
  }
  if (!(mp.punchRateCyclesPerMin > 0) || mp.strokeRateFactor == null) {
    return `${machineName} has no punch rate or stroke rate factor on file: sm_reference_data 'turretPunchMachine:<name>' punch_rate_cycles_min, 'strokeRateFactor:<tonnage>'`;
  }
  return null;
}

export function computeTurretPunchCost(input: TurretPunchInput): TurretPunchResult {
  const warnings: string[] = [];
  const thk = input.sheetThicknessMm;
  if (thk > 6) warnings.push(`Turret: ${thk}mm exceeds typical turret punch range (≤6 mm)`);

  const rate = input.turretRate ?? noRateFallback("turret_punch");
  const hasWork = input.pierceCount > 0 || input.cutLengthMm > 0;

  // Punched holes, tool changes and contour nibbling are one calculator run. When it
  // could not resolve, that work is missing data, not a $0 operation: the route would
  // otherwise look cheapest for the work it leaves unpriced. A gap makes it incomplete
  // (findRouteDataGaps), so it can be shown and applied by choice but never
  // auto-recommended. Where there is genuinely nothing to punch or nibble, no gap.
  let cuttingSec = 0;
  let physicsGap: PhysicsGap | undefined;
  if (typeof input.cuttingSecFromCalculator === 'number' && Number.isFinite(input.cuttingSecFromCalculator)) {
    cuttingSec = input.cuttingSecFromCalculator;
    if (input.pierceCount > 0) warnings.push("Turret: one hit per punched hole; a hole larger than the largest tool would need nibbling or a special tool, not modelled");
    if (input.cutLengthMm > 0) warnings.push("Turret: contour assumed nibbled — actual method depends on tooling setup");
  } else if (hasWork) {
    physicsGap = input.physicsGap ?? {
      gapType: 'unsupported_operation', process: 'Turret Punching', machineClass: 'turret_punch',
      reason: 'Not priced: the Sheet Metal - TPP Manufacturing calculator returned no cycle time and reported no gap (unexpected; check resolvePhysicsQuantity).',
    };
  }

  const cuttingMin = cuttingSec / 60;
  // Real setup time, most-specific real source first: this machine's own
  // mhr_records.setup_time_hr, then the per-operation sm_lookup_op_setup_time
  // row, then the cited class constant. See resolveSetupMinutes().
  const setup = resolveSetupMinutes({
    process: "Turret Punching",
    machineSetupTimeHr: rate.setupTimeHr,
    operationSetupMin: input.setupMin,
    machineName: rate.machineName,
  });
  const setupMin = setup.setupMin;
  if (setup.warning) warnings.push(setup.warning);

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
    yieldPct: resolveYieldPct(input.yieldPct, 'Turret Punch', warnings),
    netMatCost: input.netMatCost ?? 0,
    netWeightKg: input.netWeightKg ?? 0,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  const processLines: ProcessLineCost[] = [
    buildCuttingProcessLine({
      process: "Turret Punching",
      processIdentity: input.processIdentity,
      setupTimeMin: setup.setupMin,
      setupTimeSource: setup.source,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cuttingMin,
      rate,
      extra: {
        labourRate: rate.labourRate ?? null,
        ...(input.calculatorId ? { calculatorId: input.calculatorId } : {}),
        ...(input.calculatorVersion != null ? { calculatorVersion: input.calculatorVersion } : {}),
        ...(physicsGap ? { physicsGap } : {}),
        ...(input.confidence ? { confidence: input.confidence } : {}),
      },
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
      rateSource: "consumable_allowance",
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
  readonly processLabel = 'Turret Punching';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    const result = computeTurretPunchCost({
      sheetThicknessMm: context.sheetThicknessMm,
      pierceCount: context.pierceCount,
      cutLengthMm: context.cutLengthMm,
      batchSize: context.batchSize,
      turretRate: context.rate,
      processIdentity: context.processIdentity,
      cuttingSecFromCalculator: context.cuttingSecFromCalculator,
      calculatorId: context.calculatorId,
      calculatorVersion: context.calculatorVersion,
      physicsGap: context.physicsGap,
      confidence: context.confidence,
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

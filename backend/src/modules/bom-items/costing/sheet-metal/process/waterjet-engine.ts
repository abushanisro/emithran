import {
  WATERJET_ABRASIVE_KG_PER_MIN,
  resolveYieldPct,
} from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ConfidenceLevel, PhysicsGap, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { r2, noRateFallback, eMithranTerms, resolveSetupMinutes } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface WaterjetInput {
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;  // contour starts
  batchSize: number;
  waterjetRate?: MHRRateInput;
  // Garnet price in the SAME currency as waterjetRate.rate.
  // Resolved from consumable_prices DB table (migration 362) by the service.
  // When null/absent there is no price on file: abrasive cost is 0 AND the
  // result carries a warning saying so (never a silent 0).
  abrasivePricePerKg?: number | null;
  // Real process_calculator_mappings identity for the resolved machine class,
  // resolved by the caller (BomItemsService.resolveProcessIdentities()) — never
  // hardcoded here. Absent means the caller couldn't resolve one; consumers must
  // not fabricate processGroup/processRoute/operation in that case.
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Cycle time comes from the "Sheet Metal - Waterjet Cutting Manufacturing" DB calculator ONLY
  // (migration 905), resolved by the caller's resolvePhysicsQuantity: contour cut length plus the
  // lead-in and lead-out of every start at the material cutting speed, times the cut-time
  // adjustment factor, plus the machine nozzle delay at every pierce. `activeCuttingSec` is the
  // cutting part of that (abrasive and nozzle wear are charged on it, not on piercing).
  // Undefined when the calculator could not resolve one; `physicsGap` then carries the reason.
  cuttingSecFromCalculator?: number;
  activeCuttingSecFromCalculator?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  physicsGap?: PhysicsGap | null;
  confidence?: ConfidenceLevel;
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
  // SheetMetalLookupService.getOpSetupTime('waterjet'). The selected machine's
  // real per-machine setup_time_hr wins; with neither, setup is not costed
  // (resolveSetupMinutes returns source 'none' with a warning).
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

interface WaterjetResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  abrasiveCost: number;  // same currency as the machine rate / abrasivePricePerKg
  warnings: string[];
}

// The machine whose mixing tube the sm_lookup_waterjet_cut reference tier is taken to describe: a
// 50 HP, 60,000 psi Flow pump, the tier migration 398 states for that table.
export const WATERJET_REFERENCE_MACHINE = 'Flow Mach 2 1313b';

/**
 * Cut-speed factor of a machine against the reference tier: its focusing tube diameter over the
 * reference machine. The revised abrasive waterjet model (Hlavac et al., Materials 2021,
 * PMC8303882, eq. 28) scales the traverse speed limit with the focusing tube diameter. An
 * estimate, shown as such on the line; null when either tube is not on file.
 */
export function waterjetSpeedFactor(machineTubeMm: number | null, referenceTubeMm: number | null): number | null {
  if (machineTubeMm == null || referenceTubeMm == null || machineTubeMm <= 0 || referenceTubeMm <= 0) return null;
  return machineTubeMm / referenceTubeMm;
}

/** Why the waterjet calculator cannot be seeded, or null when every input is on file. */
export function waterjetMissingInputs(input: {
  machineName: string | null | undefined;
  hasCuttingSpeed: boolean;
  speedFactor: number | null;
  nozzleDelaySec: number | null;
  leadInMm: number | null;
  adjustmentFactor: number | null;
}): string | null {
  if (!input.machineName) {
    return 'no waterjet machine could be selected for this part, so there is no machine pierce time to read; see the capability warning for the thickness and bed size that ruled every machine out';
  }
  if (input.nozzleDelaySec == null) return `${input.machineName} has no nozzle_delay_s on file (machine library)`;
  if (!input.hasCuttingSpeed) return 'no sm_lookup_waterjet_cut cutting speed for this material and thickness';
  if (input.speedFactor == null) return `${input.machineName} or the reference machine ${WATERJET_REFERENCE_MACHINE} has no mixing_tube_diameter_mm on file (machine library)`;
  if (input.leadInMm == null) return 'variable standardWaterjetCutLeadInAmount is not staged';
  if (input.adjustmentFactor == null) return 'variable waterjetCutTimeAdjustmentFactor is not staged';
  return null;
}

export function computeWaterjetCost(input: WaterjetInput): WaterjetResult {
  const warnings: string[] = [];
  if (input.sheetThicknessMm === 0) warnings.push("Waterjet: thickness 0 — cutting speed lookup cannot resolve without a real thickness");

  const rate = input.waterjetRate ?? noRateFallback("waterjet");

  // Work with no calculator time is missing data, not a $0 operation: the route would otherwise
  // look cheapest for the work it leaves unpriced (a gap makes it incomplete, so it is never
  // auto-recommended). Where there is nothing to cut, no gap.
  let totalSec = 0;
  let cuttingSec = 0;
  let physicsGap: PhysicsGap | undefined;
  if (typeof input.cuttingSecFromCalculator === 'number' && Number.isFinite(input.cuttingSecFromCalculator)) {
    totalSec = input.cuttingSecFromCalculator;
    cuttingSec = input.activeCuttingSecFromCalculator ?? input.cuttingSecFromCalculator;
  } else if (input.cutLengthMm > 0 || input.pierceCount > 0) {
    physicsGap = input.physicsGap ?? {
      gapType: 'unsupported_operation', process: 'Waterjet Cutting', machineClass: 'waterjet',
      reason: 'Not priced: the Sheet Metal - Waterjet Cutting Manufacturing calculator returned no cycle time and reported no gap (unexpected; check resolvePhysicsQuantity).',
    };
  }
  const cuttingMin = totalSec / 60;

  // Abrasive charged only for active cutting time, not piercing
  if (input.abrasivePricePerKg == null && cuttingSec > 0) {
    warnings.push("Waterjet: no garnet abrasive price in consumable_prices for this location — abrasive cost excluded from quote; add a consumable_prices row to price it");
  }
  const abrasivePricePerKg = input.abrasivePricePerKg ?? 0;
  if (input.abrasiveKgPerMin == null && cuttingSec > 0) {
    warnings.push("Waterjet: abrasive consumption rate from fallback — seed sm_lookup_waterjet_abrasive_rate for this pump tier");
  }
  const abrasiveKgPerMin = input.abrasiveKgPerMin ?? WATERJET_ABRASIVE_KG_PER_MIN;
  const abrasiveCost = r2(
    (cuttingSec / 60) * abrasiveKgPerMin * abrasivePricePerKg,
  );

  // Real setup time, most-specific real source first: this machine's own
  // mhr_records.setup_time_hr, then the per-operation sm_lookup_op_setup_time
  // row, then the cited class constant. See resolveSetupMinutes().
  const setup = resolveSetupMinutes({
    process: "Waterjet Cutting",
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
    yieldPct: resolveYieldPct(input.yieldPct, 'Waterjet', warnings),
    netMatCost: input.netMatCost ?? 0,
    netWeightKg: input.netWeightKg ?? 0,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  const processLines: ProcessLineCost[] = [
    buildCuttingProcessLine({
      process: "Waterjet Cutting",
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
      rateSource: "consumable_allowance",
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
  readonly processLabel = 'Waterjet Cutting';

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
      cuttingSecFromCalculator: context.cuttingSecFromCalculator,
      activeCuttingSecFromCalculator: context.activeCuttingSecFromCalculator,
      calculatorId: context.calculatorId,
      calculatorVersion: context.calculatorVersion,
      physicsGap: context.physicsGap,
      confidence: context.confidence,
    });
  }
}

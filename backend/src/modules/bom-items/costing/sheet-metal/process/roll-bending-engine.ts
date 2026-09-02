import { ROLL_BENDING_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

export interface RollBendingInput {
  // The flat pattern's real feed-length dimension (item.maxLength) — the
  // dimension fed through the rolls. NOT cut length or bend length; a
  // genuinely distinct geometry input this engine is the first to use.
  rollFeedLengthMm: number;
  batchSize: number;
  rollBendingRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
  // Real per-SELECTED-MACHINE rolling speed (mm/s) and pre-bend time (s),
  // resolved by the caller via SheetMetalLookupService.
  // getRollBendingMachineParams(). prebendTimeSec is a real per-machine
  // value for 3/4-Roll machines and genuinely 0 for 2-Roll machines (no
  // prebend step in the real source data) — never fabricated either way.
  // Missing real data (no row for this machine) means an honest $0/0-min
  // cycle time, never a guess.
  rollingSpeedMmPerSec?: number;
  prebendTimeSec?: number;
  setupMin?: number;
  dlrPerHr?: number;
  qairPerHr?: number;
  inspTimeMin?: number;
  samplingRate?: number;
  yieldPct?: number;
  netMatCost?: number;
  netWeightKg?: number;
  scrapPricePerKg?: number;
}

export interface RollBendingResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  // Always 0 — roll bending has no abrasive/wear consumable modeled. Kept
  // only so this result shape satisfies the shared CuttingProcessResult
  // contract.
  abrasiveCost: number;
  warnings: string[];
}

export function computeRollBendingCost(
  processLabel: string,
  machineClass: 'roll_bending_2' | 'roll_bending_3' | 'roll_bending_4',
  input: RollBendingInput,
): RollBendingResult {
  const warnings: string[] = [];
  const rate = input.rollBendingRate ?? noRateFallback(machineClass);

  let cycleSec = 0;
  if (input.rollingSpeedMmPerSec != null && input.rollingSpeedMmPerSec > 0) {
    const rollingSec = input.rollFeedLengthMm > 0 ? input.rollFeedLengthMm / input.rollingSpeedMmPerSec : 0;
    const prebendSec = input.prebendTimeSec ?? 0;
    cycleSec = rollingSec + prebendSec;
  } else if (input.rollFeedLengthMm > 0) {
    warnings.push(
      `${processLabel}: no real rolling-speed data on file for ${rate.machineName ?? 'the selected machine'} (sm_reference_data 'rollBenderMachine:*') — cycle time is $0 until real data is added for it, not an estimate`,
    );
  }
  const cycleMin = cycleSec / 60;

  if (input.setupMin == null) {
    warnings.push(`${processLabel}: setup time from fallback — seed sm_lookup_op_setup_time for '${machineClass}'`);
  }
  const setupMin = input.setupMin ?? ROLL_BENDING_SETUP_MIN;

  const t = eMithranTerms({
    mhrPerHr: rate.rate,
    dlrPerHr: rate.labourRate ?? input.dlrPerHr ?? 0,
    qairPerHr: input.qairPerHr ?? 0,
    setupNDL: rate.operators ?? 1,
    cycleNDL: rate.operators ?? 1,
    cycleTimeMin: cycleMin,
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
      process: processLabel,
      processIdentity: input.processIdentity,
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: cycleMin,
      rate,
      extra: { labourRate: rate.labourRate ?? null },
    }),
  ];

  return { processLines, cuttingMin: cycleMin, abrasiveCost: 0, warnings };
}

// Thin ManufacturingProcessEngine wrapper — one shared formula, three real
// registered classes (2 Roll Bender / 3 Roll Bender / 4 Roll Bender,
// 2026-09-01). Genuinely distinct real machine pools (4/25/19 machines, no
// name overlap — verified before this split), previously all sharing one
// undifferentiated 'roll_forming' machine_class with no registered engine
// behind it at all — an active phantom-calculator route in the live catalog
// before this fix. processFamily 'sheet_metal_forming' — same family as
// Standard/Tandem/Progressive-Die Press, no MachineRequirement built for any
// of them (see bom-items.service.ts's requirements-building block).
export class RollBendingEngine extends BaseCuttingEngine {
  readonly machineClass: 'roll_bending_2' | 'roll_bending_3' | 'roll_bending_4';
  readonly processFamily = 'sheet_metal_forming';
  private readonly processLabel: string;

  constructor(machineClass: 'roll_bending_2' | 'roll_bending_3' | 'roll_bending_4', processLabel: string) {
    super();
    this.machineClass = machineClass;
    this.processLabel = processLabel;
  }

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    return computeRollBendingCost(this.processLabel, this.machineClass, {
      rollFeedLengthMm: context.flatPatternLengthMm ?? 0,
      batchSize: context.batchSize,
      rollBendingRate: context.rate,
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
      ...(context.rollBendingParams?.dataFound ? {
        rollingSpeedMmPerSec: context.rollBendingParams.rollingSpeedMmPerSec,
        prebendTimeSec: context.rollBendingParams.prebendTimeSec,
      } : {}),
    });
  }
}

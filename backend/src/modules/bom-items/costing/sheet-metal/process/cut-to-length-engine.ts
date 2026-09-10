import { CUT_TO_LENGTH_SETUP_MIN, DEFAULT_YIELD_PCT } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { CuttingProcessContext, CuttingProcessResult } from '../../shared/core/manufacturing-process.types';
import { noRateFallback, eMithranTerms, resolveSetupMinutes } from '../../shared/core/engine-kernel';
import { BaseCuttingEngine, buildCuttingProcessLine } from '../../shared/core/engine-orchestrator';

// Root-caused 2026-09-10, user-confirmed real Digital Factory category:
// "Cut To Length Line (CTL)" — 8 real machines, uncoiling/straightening/
// shearing flat blanks to length from coil stock. Genuinely unwired before
// this: migration 572 (2026-08-25) found "Cut To Length Line has no row at
// all" in process_calculator_mappings — "a true gap with nothing to link",
// and its 40 real mhr_records rows (8 machines x 5 locations) carried no
// machine_class at all (confirmed by direct query, 2026-09-10).
//
// THE REAL FORMULA, NOT A GUESS
//
// memory/sheetmetal/machine/machine_library.json's CTL machines each carry
// real, sourced fields: const_coeff_cycle_time, mass_coeff_cycle_time,
// const_coeff_handling_time, mass_coeff_handling_time_s_kg, cut_speed_s
// (staged into mhr_records.specs by migration 538, promoted to real
// dedicated columns by migration 724). The const_coeff_X/mass_coeff_X_s_kg
// naming is a direct, textually-supported parallel to this codebase's own
// already-proven linear handling-time formula (migration 608,
// press-stroke-engine.ts: handlingSec = handlingConstS + handlingMassCoeffSPerKg
// x partWeightKg) — not a novel invention, the same real shape applied to a
// second real field pair on the exact same machines.
//
// Composition mirrors press-stroke-engine.ts's own proven pattern exactly
// (cycleMin = (machineOwnCycleComponent + handlingSec) / 60): this engine's
// own cycle component is the machine's real linear feed-to-length time plus
// its fixed real shear-stroke duration, and handlingSec reuses the SAME
// handlingConstS/handlingMassCoeffSPerKg fields already on MHRRateInput —
// same physical concept (material handling/positioning), not duplicated.
//
//   ownCycleSec = cutToLengthCycleConstS + cutToLengthCycleMassCoeffSPerKg x netWeightKg + cutToLengthCutSpeedS
//   handlingSec = handlingConstS + handlingMassCoeffSPerKg x netWeightKg
//   cycleTimeMin = (ownCycleSec + handlingSec) / 60
export interface CutToLengthInput {
  batchSize: number;
  ctlRate?: MHRRateInput;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
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

export interface CutToLengthResult {
  processLines: ProcessLineCost[];
  cuttingMin: number;
  abrasiveCost: number;
  warnings: string[];
}

export function computeCutToLengthCost(input: CutToLengthInput): CutToLengthResult {
  const warnings: string[] = [];
  const rate = input.ctlRate ?? noRateFallback('cut_to_length');
  const netWeightKg = input.netWeightKg ?? 0;

  let cycleMin = 0;
  const hasRealFormula =
    rate.cutToLengthCycleConstS != null
    && rate.cutToLengthCycleMassCoeffSPerKg != null
    && rate.cutToLengthCutSpeedS != null;

  if (hasRealFormula && netWeightKg > 0) {
    const ownCycleSec =
      rate.cutToLengthCycleConstS! + rate.cutToLengthCycleMassCoeffSPerKg! * netWeightKg + rate.cutToLengthCutSpeedS!;
    const handlingSec =
      rate.handlingConstS != null && rate.handlingMassCoeffSPerKg != null
        ? rate.handlingConstS + rate.handlingMassCoeffSPerKg * netWeightKg
        : 0;
    // A real linear formula can mathematically go negative for a very light
    // part (const_coeff_cycle_time is -3.69s) -- floor at 0 rather than
    // charge negative machine time, same convention every other engine here
    // uses for its own formula edge cases.
    cycleMin = Math.max(0, ownCycleSec + handlingSec) / 60;
  } else if (rate.machineName == null || rate.rate <= 0) {
    warnings.push(
      'Cut To Length Line: no capable machine on file for this part in this location, so no ' +
      'machine was selected and no cycle time could be resolved. This is a machine ' +
      'capability/rate gap, not missing formula data — check the capability limits ' +
      '(thickness, coil width) on the candidate machines.',
    );
  } else if (netWeightKg <= 0) {
    warnings.push(
      'Cut To Length Line: no real part weight resolved, so no cycle time could be computed ' +
      `for ${rate.machineName}.`,
    );
  } else {
    warnings.push(
      `Cut To Length Line: no real cut-to-length cycle formula on file for ${rate.machineName} — ` +
      'cycle time is $0 until real data is added for it, not an estimate.',
    );
  }

  // Same resolver every other sheet-metal engine uses: calculator -> this
  // machine's own mhr_records.setup_time_hr -> the per-operation
  // sm_lookup_op_setup_time row -> the cited class constant. Real per-machine
  // setup_time_hr for CTL is a uniform 0.14hr (8.4min) across all 8 real
  // machines on file (memory/sheetmetal/machine/machine_library.json).
  const setup = resolveSetupMinutes({
    process: 'Cut To Length Line',
    machineSetupTimeHr: rate.setupTimeHr,
    operationSetupMin: input.setupMin,
    classDefaultMin: CUT_TO_LENGTH_SETUP_MIN,
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
    cycleTimeMin: cycleMin,
    setupTimeMin: setupMin / Math.max(input.batchSize, 1),
    inspTimeMin: input.inspTimeMin ?? 0,
    samplingRate: input.samplingRate ?? 0,
    yieldPct: input.yieldPct ?? DEFAULT_YIELD_PCT,
    netMatCost: input.netMatCost ?? 0,
    netWeightKg,
    scrapPricePerKg: input.scrapPricePerKg ?? 0,
  });

  return {
    processLines: [
      buildCuttingProcessLine({
        process: 'Cut To Length Line',
        processIdentity: input.processIdentity,
        setupTimeMin: setup.setupMin,
        setupTimeSource: setup.source,
        setupCost: t.setupCost,
        runCost: t.machineCost + t.laborCost,
        totalCost: t.total,
        cycleTimeMin: cycleMin,
        rate,
        extra: {
          labourRate: rate.labourRate ?? null,
        },
      }),
    ],
    cuttingMin: cycleMin,
    abrasiveCost: 0,
    warnings,
  };
}

// Thin ManufacturingProcessEngine wrapper — registered in
// manufacturing-process-registry.ts. Real machine pool: memory/sheetmetal/
// machine/machine_library.json's "Cut To Length Line (CTL)" category (8
// machines, 40 real mhr_records rows across 5 locations), correctly
// classified by migration 724 -- no longer 40 orphaned, invisible rows.
export class CutToLengthEngine extends BaseCuttingEngine {
  readonly machineClass = 'cut_to_length';
  readonly processFamily = 'sheet_metal_cutting';
  readonly processLabel = 'Cut To Length Line';

  computeCost(context: CuttingProcessContext): CuttingProcessResult {
    const result = computeCutToLengthCost({
      batchSize: context.batchSize,
      ctlRate: context.rate,
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
    });
    return result;
  }
}

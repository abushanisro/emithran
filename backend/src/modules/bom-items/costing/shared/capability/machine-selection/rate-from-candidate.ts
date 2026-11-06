// The cost engines' rate for a machine, built from the machine the selector chose: one mapping, so no caller can leave out a field the engines
// charge (the setup time, the operator rate, the headcount). Pure: a candidate in, the engine's rate out.
import type { MachineCandidate, MachineSelectionResult } from '../../../../dto/machine-selection.dto';
import type { MHRRateInput } from '../../core/cost-engine';
import type { MachineClass } from '../../core/default-rates.constants';

/**
 * `usdToLocal` converts the machine's own labour rate (stored in USD) to the factory's currency: the machine hour rate is already stored there,
 * and the two are added on one line. A candidate with no real machine behind it is a rate of 0 with source 'no_db_rate', which the engines name
 * as not costed.
 */
export function mhrRateFromCandidate(
  cand: MachineCandidate,
  machineClass: MachineClass,
  usdToLocal: number,
  selection?: MachineSelectionResult,
): MHRRateInput {
  const real = cand.machineId != null;
  const labourUsd = real ? cand.laborRateUsdHr : null;
  const labourRate = labourUsd != null && labourUsd > 0 ? labourUsd * usdToLocal : null;
  return {
    rate: real ? cand.hourlyRate : 0,
    source: real ? 'mhr_database' : 'no_db_rate',
    machineClass,
    machineName: cand.machineName,
    commodityCode: cand.commodityCode,
    ...(selection ? { selection } : {}),
    operators: cand.operators,
    machineLaborRateUsdHr: cand.laborRateUsdHr,
    labourRate,
    labourRateSource: labourRate != null ? 'mhr_machine_specific' : 'no_lhr_rate',
    pressCycleTimeS: cand.pressCycleTimeS,
    handlingConstS: cand.handlingConstS,
    handlingMassCoeffSPerKg: cand.handlingMassCoeffSPerKg,
    cutToLengthCycleConstS: cand.cutToLengthCycleConstS,
    cutToLengthCycleMassCoeffSPerKg: cand.cutToLengthCycleMassCoeffSPerKg,
    cutToLengthCutSpeedS: cand.cutToLengthCutSpeedS,
    numberSpindles: cand.numberSpindles,
    drumIndexTimeS: cand.drumIndexTimeS,
    transferTimeS: cand.transferTimeS,
    stockFeedTimeS: cand.stockFeedTimeS,
    speedSynchronizationTimeS: cand.speedSynchronizationTimeS,
    setupTimeHr: cand.setupTimeHr,
    directOverheadRate: cand.directOverheadRate,
    indirectOverheadRate: cand.indirectOverheadRate,
  };
}

// The cost engines' rate for a machine, built from the machine the selector chose: one mapping, so no caller can leave out a field the engines
// charge (the setup time, the operator rate, the headcount). Pure: a candidate in, the engine's rate out.
import type { MachineCandidate, MachineRecommendation, MachineSelectionResult } from '../../../../dto/machine-selection.dto';
import type { MHRRateInput } from '../../core/cost-engine';
import type { MachineClass } from '../../core/default-rates.constants';

/**
 * Every hour rate a selection carries (the three picks, the alternatives, the ranking), through `conv`. Used to bring a selection into the
 * factory currency (the candidates are read in USD) and from there into the display currency, so the machine list beside a line is always in
 * the line's own currency.
 */
export function convertSelectionRates(ms: MachineSelectionResult, conv: (v: number) => number): MachineSelectionResult;
export function convertSelectionRates(ms: MachineSelectionResult | undefined, conv: (v: number) => number): MachineSelectionResult | undefined;
export function convertSelectionRates(ms: MachineSelectionResult | undefined, conv: (v: number) => number): MachineSelectionResult | undefined {
  if (!ms) return ms;
  const candidate = (c: MachineCandidate): MachineCandidate => ({ ...c, hourlyRate: conv(c.hourlyRate) });
  const recommendation = (r: MachineRecommendation): MachineRecommendation => ({ ...r, candidate: candidate(r.candidate) });
  return {
    ...ms,
    balanced: recommendation(ms.balanced),
    cheapest: recommendation(ms.cheapest),
    fastest: recommendation(ms.fastest),
    alternatives: ms.alternatives.map(candidate),
    ...(ms.ranking ? { ranking: ms.ranking.map((r) => ({ ...r, hourlyRate: conv(r.hourlyRate) })) } : {}),
  };
}

/**
 * The machine's rate in the factory's currency. HR Rates holds every machine in USD, whatever its location (mhr_records.currency_code is USD
 * on every row, India's included): `usdToLocal` converts both the machine hour rate and the machine's own labour rate, and the selection the
 * line carries, so a line's machine and labour are added in one currency. Converting only the labour (as this did) left an India machine
 * at its USD number read as rupees, 64x too cheap. A candidate with no real machine behind it is a rate of 0 with source 'no_db_rate', which
 * the engines name as not costed.
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
  const local = (v: number) => v * usdToLocal;
  return {
    rate: real ? local(cand.hourlyRate) : 0,
    source: real ? 'mhr_database' : 'no_db_rate',
    machineClass,
    machineName: cand.machineName,
    commodityCode: cand.commodityCode,
    ...(selection ? { selection: usdToLocal === 1 ? selection : convertSelectionRates(selection, local) } : {}),
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

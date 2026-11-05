// Closed-die hot forging: one process line priced on its machine, or a named
// gap. Pure.
//
// Machines are the forging rows of HR Rates (mhr_records, migration 824, from
// memory/Forging/Machine/*.csv): machine hour rate (Direct + Indirect OH),
// labour rate, crew and setup time per row, capability in specs.
//
// A line is priced only for candidates the caller has already judged capable,
// each with its own cycle time; every one is costed through eMithranTerms
// (machine + crew x labour per cycle, setup spread over the batch, the same
// as hpdc-engine.ts) and the cheapest per part wins. Capability and cycle time
// are the caller's: for every forging step except the material they need
// formulas memory does not hold yet (v1.1 sections 6.7-6.9), so the engine
// returns forgingGapLine for those steps instead.

import { machineChoice, type ChoiceEval } from '../casting/machine-choice';
import { eMithranTerms, type EMithranTermsArgs } from '../shared/core/engine-kernel';

import type { MachineChoiceDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';

/** Staged process names (823 process rows) and their HR Rates machine classes (824). */
export const FORGING_STEPS = {
  bandSaw: { process: 'Band Saw', machineClass: 'forging_band_saw' },
  inductionHeat: { process: 'Conveyor Induction Heat', machineClass: 'forging_conveyor_induction_heat' },
  furnaceHeat: { process: 'Preheat', machineClass: 'forging_oven_furnace' },
  press: { process: 'Press', machineClass: 'forging_press' },
  mechanicalPress: { process: 'Mechanical Press', machineClass: 'forging_mechanical_press' },
  hammer: { process: 'Hammer', machineClass: 'forging_hammer' },
  trim: { process: 'Trim', machineClass: 'forging_trim' },
} as const;

export type ForgeClass = 'press' | 'mechanicalPress' | 'hammer';

export interface ForgingMachine {
  id: string;
  name: string;
  machineClass: string;
  /** Machine hour rate and labour rate per hour, in the quote currency (HR Rates holds USD; the caller converts). */
  machineRatePerHr: number | null;
  labourRatePerHr: number | null;
  operators: number | null;
  setupTimeHr: number | null;
  /** mhr_records.specs as staged (press_force_kn, impact_energy_j, cycle_time_s, ...). */
  specs: Readonly<Record<string, unknown>>;
}

export interface LineCandidate {
  machine: ForgingMachine;
  /** Failed criteria; empty = capable. */
  reasons: string[];
  /** Cycle per part (s) on this machine; required when capable. */
  cycleTimeS: number | null;
}

export type CostContext = Omit<EMithranTermsArgs, 'mhrPerHr' | 'dlrPerHr' | 'setupNDL' | 'cycleNDL' | 'cycleTimeMin' | 'setupTimeMin'>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** A line that is not costed, naming why (the same shape as hpdc-engine.ts gapLine). */
export function forgingGapLine(step: { process: string; machineClass: string }, reason: string, choice?: MachineChoiceDto | null): ProcessLineCost {
  return {
    process: step.process,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0,
    hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: step.machineClass,
    machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: step.process, machineClass: step.machineClass, reason },
    ...(choice ? { machineChoice: choice } : {}),
  };
}

interface Priceable { mhr: number; dlr: number; crew: number; setupHr: number; cycleS: number }

/** The candidate's rates and cycle, or every reason it cannot be priced (the caller's capability reasons first). */
function priceable(c: LineCandidate): { ok: true; p: Priceable } | { ok: false; reasons: string[] } {
  const m = c.machine;
  const reasons = [...c.reasons];
  if (m.machineRatePerHr == null) reasons.push('no machine hour rate on file');
  if (m.labourRatePerHr == null || m.operators == null) reasons.push('no labour rate or crew on file');
  if (m.setupTimeHr == null) reasons.push('no setup time on file');
  if (!(c.cycleTimeS != null && c.cycleTimeS > 0)) reasons.push('no cycle time');
  if (reasons.length || m.machineRatePerHr == null || m.labourRatePerHr == null || m.operators == null
    || m.setupTimeHr == null || c.cycleTimeS == null) return { ok: false, reasons };
  return { ok: true, p: { mhr: m.machineRatePerHr, dlr: m.labourRatePerHr, crew: m.operators, setupHr: m.setupTimeHr, cycleS: c.cycleTimeS } };
}

export function priceForgingLine(input: {
  step: { process: string; machineClass: string };
  criteria: string[];
  candidates: readonly LineCandidate[];
  batchSize: number | null;
  costContext: CostContext;
}): { line: ProcessLineCost; ok: boolean } {
  const { step } = input;
  if (input.batchSize == null || !(input.batchSize > 0)) {
    return { ok: false, line: forgingGapLine(step, `${step.process}: batch size not set (setup is spread over the batch).`) };
  }
  const batch = input.batchSize;
  const evals = input.candidates.map((c) => {
    const e = priceable(c);
    if (!e.ok) return { c, reasons: e.reasons, priced: null };
    const { p } = e;
    const terms = eMithranTerms({
      ...input.costContext,
      mhrPerHr: p.mhr,
      dlrPerHr: p.dlr,
      setupNDL: p.crew,
      cycleNDL: p.crew,
      cycleTimeMin: p.cycleS / 60,
      setupTimeMin: (p.setupHr * 60) / batch,
    });
    return { c, reasons: [] as string[], priced: { c, p, terms } };
  });
  const priced = evals
    .flatMap((e) => (e.priced ? [e.priced] : []))
    .sort((a, b) => a.terms.total - b.terms.total);
  const best = priced.length ? priced[0] : null;
  const choice = machineChoice({
    rule: 'Cheapest cost per part among the capable machines (each with its own cycle, machine + crew rate and setup over the batch)',
    criteria: input.criteria,
    evals: evals.map((e): ChoiceEval => (e.priced
      ? { name: e.c.machine.name, reasons: [], cost: e.priced.terms.total, note: `cycle ${e.priced.p.cycleS} s` }
      : { name: e.c.machine.name, reasons: e.reasons })),
    chosen: best ? best.c.machine.name : null,
  });
  if (!best) {
    return { ok: false, line: forgingGapLine(step, `No ${step.process} machine in HR Rates (${input.candidates.length} checked) is capable with a rate, crew, setup and cycle time on file.`, choice) };
  }
  const m = best.c.machine;
  const { p } = best;
  return {
    ok: true,
    line: {
      process: step.process,
      setupCost: r2(best.terms.setupCost),
      runCost: r2(best.terms.total - best.terms.setupCost),
      totalCost: r2(best.terms.total),
      cycleTimeMin: r3(p.cycleS / 60),
      setupTimeMin: r3(p.setupHr * 60),
      setupTimeSource: 'machine',
      operators: p.crew,
      hourlyRate: p.mhr,
      rateSource: 'mhr_database',
      machineClass: step.machineClass,
      machineName: m.name,
      commodityCode: null,
      labourRate: p.dlr,
      mhrId: m.id,
      machineChoice: choice,
    },
  };
}

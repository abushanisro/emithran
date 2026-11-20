// The routes of a Multi-Spindle Machining part (user decision 2026-11-20): a 6-spindle, an 8-spindle and a twin-spindle turning center,
// each on its cheapest capable machine (the bar within its bar capacity, the length per part within its length), the cheapest quoted. Pure.
//
// A machine's cycle is its station plan's slowest station plus its index (calculator "Multi-Spindle Machining - Cycle", migration 1095):
// the part's in-cycle operations (multi-spindle-work.ts) laid out over its stations (multi-spindle-stations.ts), rough turning and long
// end-slide drilling split across stations as tblMultiSpindleOpSplitting says for the machine's spindle count once the part's ratio
// reaches the threshold.
import { MULTI_SPINDLE_CYCLE_SOURCE } from './multi-spindle-research';
import { planStations, type SpindleLayout, type StationOp, type StationPlan } from './multi-spindle-stations';
import { machineValue, type SandMachine } from '../casting/sand/sand-machines';
import { seedsFor } from '../casting/sand/sand-seeds';
import { selectAndCost, type StepOutcome } from '../casting/sand/sand-steps';
import { runReferenceCalculator, type ReferenceCalculatorDef } from '../shared/calculators/reference-calculator';
import { MULTI_SPINDLE_PROCESS_GROUP } from '../shared/core/part-family-process-group';

import type { WorkOp } from './multi-spindle-work';
import type { ProcessLineCost } from '../../dto/cost-breakdown.dto';
import type { CostContext } from '../casting/casting-finishing';
import type { SandReference } from '../casting/sand/sand-reference';
import type { DomainCalculatorSpec } from '../shared/calculators/domain-calculator-spec';

export { MULTI_SPINDLE_PROCESS_GROUP };
export const MULTI_SPINDLE_PROCESS = 'Simultaneous Turning';
export const MULTI_SPINDLE_MACHINE_CLASS = 'simultaneous_turning';
export const MULTI_SPINDLE_CALC = { stock: 'Multi-Spindle Machining - Bar Stock', cycle: 'Multi-Spindle Machining - Cycle' } as const;
/** The HR Rates columns of a multi-spindle the routes read (migrations 788 and 1093), kept in its specs. */
export const MULTI_SPINDLE_MACHINE_COLUMNS = [
  'number_spindles', 'max_diameter_mm', 'max_length_mm', 'drum_index_time_s', 'transfer_time_s', 'stock_feed_time_s', 'speed_synchronization_time_s',
] as const;

export const MULTI_SPINDLE_ROUTES = [
  { key: '6', label: '6-spindle multi-spindle', spindles: 6 },
  { key: '8', label: '8-spindle multi-spindle', spindles: 8 },
  { key: 'twin', label: 'Twin-spindle turning center', spindles: 2 },
] as const;
export type MultiSpindleRouteKey = (typeof MULTI_SPINDLE_ROUTES)[number]['key'];

/** A tblMultiSpindleOpSplitting rule for one spindle count: the passes and the threshold that triggers them. */
export interface SplitRule {
  passes: number;
  threshold: number;
}
export type SplitRules = (feature: string, operation: string, spindles: number) => SplitRule | null;

/** What the part asks of a machine: its in-cycle operations, the bar (its corners' diameter) and the bar each part takes. */
export interface MultiSpindleWork {
  ops: readonly WorkOp[];
  barCircumscribedMm: number;
  lengthPerPartMm: number;
}

export interface MultiSpindleRoute {
  key: MultiSpindleRouteKey;
  label: string;
  /** The Simultaneous Turning line on the route's machine, USD; a named gap when no machine of the route can make the part. */
  line: ProcessLineCost;
  machine: SandMachine | null;
  plan: StationPlan | null;
  cycleSec: number | null;
  indexSec: number | null;
  complete: boolean;
  /** The operations split across stations on the route's machine, and why (tblMultiSpindleOpSplitting). */
  splits: string[];
  warnings: string[];
}

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const spindleList = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
const r1 = (n: number) => Math.round(n * 10) / 10;
/** A calculator source's key without its description: "slowest_station_s (the longest station ...)" is slowest_station_s. */
export const keyName = (key: string) => key.split(' (')[0].trim();

/** The machine's spindles and slides (migration 1093 specs), or null when they are not on file. */
export function layoutOf(m: SandMachine): SpindleLayout | null {
  const spindles = machineValue(m, 'number_spindles');
  const od = spindleList(m.specs.od_slide_spindles);
  if (spindles == null || od.length === 0) return null;
  return {
    spindles, od, end: spindleList(m.specs.end_slide_spindles), live: spindleList(m.specs.live_tooling_spindles), back: spindleList(m.specs.back_work_spindles),
  };
}

/** The operations as a machine of `spindles` spindles runs them: each split into the passes its rule gives once its ratio reaches the threshold. */
export function splitOps(ops: readonly WorkOp[], spindles: number, rules: SplitRules): { ops: StationOp[]; notes: string[] } {
  const notes: string[] = [];
  const out = ops.map(({ splitBy, ...op }): StationOp => {
    const rule = splitBy ? rules(splitBy.feature, splitBy.operation, spindles) : null;
    if (!splitBy || !rule || rule.passes <= 1 || splitBy.ratio < rule.threshold) return op;
    notes.push(`${op.name} split over ${rule.passes} stations: ${splitBy.what} = ${splitBy.ratio.toFixed(2)}, at least ${rule.threshold} (tblMultiSpindleOpSplitting, ${spindles} spindles)`);
    return { ...op, split: rule.passes };
  });
  return { ops: out, notes };
}

/** Why a machine cannot take the part's bar, or [] when it can. */
export function capacityReasons(m: SandMachine, work: Pick<MultiSpindleWork, 'barCircumscribedMm' | 'lengthPerPartMm'>): string[] {
  const maxD = num(machineValue(m, 'max_diameter_mm'));
  const maxL = num(machineValue(m, 'max_length_mm'));
  return [
    maxD == null ? 'no bar capacity on file (migration 1093)' : work.barCircumscribedMm > maxD + 1e-9 ? `takes bar up to Ø${maxD} mm, the bar is Ø${r1(work.barCircumscribedMm)} mm across its corners` : '',
    maxL == null ? 'no part length limit on file (migration 1093)' : work.lengthPerPartMm > maxL + 1e-9 ? `takes parts up to ${maxL} mm long, each part takes ${r1(work.lengthPerPartMm)} mm of bar` : '',
  ].filter(Boolean);
}

export function buildMultiSpindleRoutes(input: {
  ref: SandReference;
  spec: DomainCalculatorSpec;
  calculators: Readonly<Record<string, ReferenceCalculatorDef>>;
  machines: readonly SandMachine[];
  work: MultiSpindleWork;
  rules: SplitRules;
  batchSize: number;
  costContext: CostContext;
}): MultiSpindleRoute[] {
  const calc = input.spec.calculators.find((c) => c.name === MULTI_SPINDLE_CALC.cycle);
  return MULTI_SPINDLE_ROUTES.map((route) => {
    const plans = new Map<string, { plan: StationPlan; indexSec: number; notes: string[] }>();
    const evaluate = (m: SandMachine): StepOutcome => {
      const layout = layoutOf(m);
      if (!layout) return { ok: false, reasons: ['no spindle or slide configuration on file (migration 1093)'] };
      const reasons = capacityReasons(m, input.work);
      if (reasons.length) return { ok: false, reasons };
      if (!calc) return { ok: false, reasons: [`${MULTI_SPINDLE_CALC.cycle} is not in the calculator spec`] };
      const { ops, notes } = splitOps(input.work.ops, layout.spindles, input.rules);
      const plan = planStations(ops, layout, {
        toolPositioningSec: num(m.specs.tool_positioning_time_s) ?? 0, partEjectSec: num(m.specs.part_eject_time_s) ?? 0,
      });
      if ('missing' in plan) return { ok: false, reasons: [plan.missing] };
      const slowest = plan.slowest;
      const doing = slowest.ops.map((o) => o.name).join(', ') || 'the part eject';
      const { seeds, missing } = seedsFor(calc, {
        engine: (source) => (keyName(source) === 'slowest_station_s'
          ? { value: slowest.seconds, source: `Station ${slowest.spindle}${slowest.back ? ' (back work)' : ''}: ${doing}, the slowest of ${plan.stations.length}. ${MULTI_SPINDLE_CYCLE_SOURCE}` }
          : null),
        machine: (column) => {
          const value = machineValue(m, column);
          return value == null ? null : {
            value, source: `${m.name}: ${column} (HR Rates)`,
            ref: { kind: 'machine', machineId: m.id, machineName: m.name, machineClass: m.machineClass, location: m.location, column },
          };
        },
      });
      if (missing.length) return { ok: false, reasons: missing.map((x) => `${MULTI_SPINDLE_CALC.cycle}: ${x}`) };
      const run = runReferenceCalculator(input.calculators, MULTI_SPINDLE_CALC.cycle, seeds, 'Cycle Time');
      if (run.value == null) return { ok: false, reasons: run.missing };
      plans.set(m.id, { plan, indexSec: run.outputs['Index Time'] ?? 0, notes });
      return { ok: true, sec: run.value, run, energyCostUsd: 0, notes: [] };
    };
    const step = selectAndCost({
      process: MULTI_SPINDLE_PROCESS, machineClass: MULTI_SPINDLE_MACHINE_CLASS, processGroup: MULTI_SPINDLE_PROCESS_GROUP, partName: 'part',
      machines: input.machines.filter((m) => machineValue(m, 'number_spindles') === route.spindles),
      criteria: [`A ${route.label}`, 'Its bar capacity takes the bar, and its length the bar each part takes', 'A slide of each kind the operations need'],
      evaluate, batchSize: input.batchSize, costContext: input.costContext, ref: input.ref,
    });
    const chosen = step.machine ? plans.get(step.machine.id) : undefined;
    return {
      key: route.key, label: route.label, line: step.line, machine: step.machine, plan: chosen?.plan ?? null,
      cycleSec: step.outcome?.sec ?? null, indexSec: chosen?.indexSec ?? null,
      complete: step.line.physicsGap == null, splits: chosen?.notes ?? [], warnings: step.warnings,
    };
  });
}

/** The route to quote: the one set in the Cost Guide or forced, else the cheapest complete one, else the first. */
export function chooseMultiSpindleRoute<T extends { key: string; complete: boolean }>(routes: readonly T[], chosen: string | null | undefined, cost: (route: T) => number): T | null {
  const set = chosen ? routes.find((r) => r.key === chosen) : undefined;
  if (set) return set;
  const complete = routes.filter((r) => r.complete).sort((a, b) => cost(a) - cost(b));
  return complete[0] ?? routes[0] ?? null;
}

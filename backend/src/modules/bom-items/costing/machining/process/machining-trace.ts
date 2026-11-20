import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';
import type { CalcRun } from '../../shared/calculators/reference-calculator';

/**
 * Builders for the machining engines' calculation trace — the same
 * CalculationTraceStep contract the sheet-metal calculators already emit and
 * CalculationTracePanel already renders (inputs with their source, then the
 * formulas in evaluation order). One contract, not a second machining-only
 * shape.
 *
 * Every input names where its value came from. The source strings follow one
 * convention so a reader can tell real data from assumptions at a glance:
 *   "CAD: …"            measured from this part's geometry
 *   "tblX: …"           a real machining_reference_data lookup row
 *   "Machine: …"        the selected machine's own mhr_records values
 *   "BOM: …"            the item's batch size / material grade
 *   "Assumption: …"     a disclosed engineering assumption, not measured data
 */
export function traceInput(
  label: string,
  value: number | string | null,
  unit: string | null,
  source: string,
  lookup = false,
): CalculationTraceStep {
  return {
    fieldName: label,
    displayLabel: label,
    kind: 'input',
    value: typeof value === 'number' ? round(value) : value,
    unit,
    source,
    ...(lookup ? { stepType: 'lookup' as const } : {}),
  };
}

export function traceCalc(
  label: string,
  value: number,
  unit: string | null,
  formula: string,
): CalculationTraceStep {
  return { fieldName: label, displayLabel: label, kind: 'calculated', value: round(value), unit, formula, stepType: 'physics' };
}

/** True when any input of the trace is a disclosed assumption rather than measured/looked-up data. */
export function traceHasAssumption(trace: CalculationTraceStep[]): boolean {
  return trace.some((s) => s.kind === 'input' && typeof s.source === 'string' && s.source.startsWith('Assumption'));
}

/** Prefixes every label of a sub-trace so several occurrences can share one line's trace. */
export function prefixTrace(prefix: string, trace: CalculationTraceStep[]): CalculationTraceStep[] {
  // The group and the calculator's own field name stay on each step, so a calculator can be refilled from one group (calculator-input-group.ts).
  const group = prefix.replace(/\s*·\s*$/, '').trim();
  return trace.map((s) => ({
    ...s, fieldName: `${prefix} ${s.fieldName}`, displayLabel: `${prefix} ${s.displayLabel}`, group, groupField: s.groupField ?? s.fieldName,
  }));
}

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
}

/**
 * The input steps a calculator is filled from, under its own field names: a line that ran it once per group (prefixTrace) fills it from its
 * first group, and each source says which group of how many. Same rule as the dialog's (lib/calculators/engine-calculator-seeds.ts).
 */
export function calculatorInputSteps(trace: readonly CalculationTraceStep[]): CalculationTraceStep[] {
  const inputs = trace.filter((st) => st.kind === 'input');
  const groups = [...new Set(inputs.map((st) => st.group).filter((g): g is string => !!g))];
  if (groups.length === 0) return inputs;
  const first = groups[0]!;
  const note = groups.length > 1 ? ` — ${first}, the first of ${groups.length} groups (${groups.join(', ')})` : ` — ${first}`;
  return inputs
    .filter((st) => !st.group || st.group === first)
    .map((st) => (st.group ? { ...st, fieldName: st.groupField ?? st.fieldName, ...(st.source ? { source: `${st.source}${note}` } : {}) } : st));
}

/** Sums several calculator runs of one operation (one per real occurrence group). */
export function sumRuns(runs: readonly { label: string; run: CalcRun }[], total: string): CalcRun {
  if (runs.length === 1) return runs[0].run;
  const trace: CalculationTraceStep[] = [];
  const missing: string[] = [];
  const lookups: CalcRun['lookups'] = {};
  let sec = 0;
  let anyPriced = false;
  for (const { label, run } of runs) {
    trace.push(...prefixTrace(`${label} ·`, run.trace));
    missing.push(...run.missing.map((m) => `${m} (${label})`));
    Object.assign(lookups, run.lookups);
    if (run.sec != null) { sec += run.sec; anyPriced = true; }
  }
  if (anyPriced) trace.push(traceCalc(total, sec, 's', 'Sum of every group Cycle Time'));
  const first = runs.find((r) => r.run.calculatorId)?.run;
  return { sec: anyPriced ? sec : null, trace, missing, calculatorId: first?.calculatorId ?? null, calculatorVersion: first?.calculatorVersion ?? null, lookups };
}

/**
 * The calculation of a line timed by one calculator run per group (a thread size, a hole diameter): each group's run, prefixed with its group
 * when there are several, then the line's cycle from them: each group's tool change and its uses, plus an allowance taken once per operation.
 */
export function groupedRunsTrace(
  process: string,
  groups: readonly { label: string; trace: CalculationTraceStep[] }[],
  allowance: { label: string; sec: number; source: string },
  totalSec: number,
): CalculationTraceStep[] {
  if (groups.length === 0) return [];
  const multi = groups.length > 1;
  return [
    ...groups.flatMap((g) => (multi ? prefixTrace(`${g.label} ·`, g.trace) : g.trace)),
    traceInput(allowance.label, allowance.sec, 's', allowance.source),
    traceCalc(`${process} cycle time`, totalSec, 's', `Sum over the groups of (Tool Change Time + No of Uses × Time per Use) + ${allowance.label}`),
  ];
}

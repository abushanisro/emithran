import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

const CYCLE_FIELDS = ['Cycle Time', 'Total Time'];

export interface CycleFields {
  /** The line's Cycle Time (or Total Time): the result. */
  cycle: CalculationTraceStep;
  /** The fields the cycle formula names, in formula order: the phases. */
  phases: CalculationTraceStep[];
  /** Every other field of the calculation, in the calculator's order. */
  others: CalculationTraceStep[];
}

/**
 * A calculation as the Cost panel lays it out: the result (by default the Cycle Time or Total Time), the fields shown first (by default the ones the
 * result's formula names: a cycle's phases), and the rest in the calculator's order. Null when the calculation has no such result.
 */
export function cycleFields(trace: readonly CalculationTraceStep[] | null | undefined, opts: { result?: string; first?: readonly string[] } = {}): CycleFields | null {
  const results = opts.result ? [opts.result] : CYCLE_FIELDS;
  const cycle = [...(trace ?? [])].reverse().find((s) => s.kind === 'calculated' && results.includes(s.fieldName));
  if (!cycle || !trace) return null;
  const byName = new Map(trace.map((s) => [s.fieldName, s]));
  const names = opts.first ? [...opts.first] : [...new Set([...(cycle.formula ?? '').matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? ''))];
  const phases = names.flatMap((n) => { const s = byName.get(n); return s ? [s] : []; });
  const taken = new Set([cycle.fieldName, ...phases.map((p) => p.fieldName)]);
  return { cycle, phases, others: trace.filter((s) => !taken.has(s.fieldName)) };
}

/** A field's value as the panel shows it: up to four significant digits, so a phase keeps its precision (2.9 s is not 3 s). */
export function formatFieldValue(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'string') return v;
  return Math.abs(v) >= 100 ? String(Math.round(v * 100) / 100) : v.toLocaleString('en-US', { maximumSignificantDigits: 3, useGrouping: false });
}

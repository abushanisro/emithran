import type { CalculationTraceStep, ProcessLineCost } from '@/lib/api/hooks/useBOMItems';

/** Mirrors the backend's CalculatorRunDto (cost-breakdown.dto.ts). */
export interface CalculatorRun {
  calculatorId: string | null;
  calculatorVersion: number | null;
  name: string;
  output: string;
  value: number | null;
  trace: CalculationTraceStep[];
  lookupMatches: Record<string, { table: string; row: Record<string, string | number> }>;
  missing: string[];
}

/** One row of the calculations list: a route step or a calculator run, with the trace behind its number. */
export interface CalculationEntry {
  key: string;
  title: string;
  kind: 'route step' | 'calculator run';
  /** The headline figure, already worded ("12.5 min", "3.2 kg"); null when the calculator gave none. */
  result: string | null;
  trace: CalculationTraceStep[];
  calculatorId: string | null;
  calculatorVersion: number | null;
  /** Inputs the calculator could not resolve. */
  missing: string[];
  /** Why there is no trace to show; null when there is one. */
  noTraceReason: string | null;
}

const NO_TRACE_LINE = 'This step is priced without a calculator trace: its figures come from the machine and rate records, not a formula.';
const NO_TRACE_RUN = 'The calculator returned no trace.';

/** Route steps first (in route order), then the calculator runs, each carrying only what the backend sent. */
export function calculationEntries(
  processLines: ProcessLineCost[] | undefined,
  runs: Record<string, CalculatorRun> | undefined,
): CalculationEntry[] {
  const lines: CalculationEntry[] = (processLines ?? []).map((l, i) => {
    const trace = l.calculationTrace ?? [];
    return {
      key: `line:${i}:${l.process}`,
      title: l.process,
      kind: 'route step',
      result: Number.isFinite(l.cycleTimeMin) ? `${round(l.cycleTimeMin)} min` : null,
      trace,
      calculatorId: l.calculatorId ?? null,
      calculatorVersion: l.calculatorVersion ?? null,
      missing: [],
      noTraceReason: trace.length ? null : NO_TRACE_LINE,
    };
  });
  const calculators: CalculationEntry[] = Object.entries(runs ?? {}).map(([name, r]) => ({
    key: `run:${name}`,
    title: r.name || name,
    kind: 'calculator run',
    result: r.value == null ? null : `${round(r.value)}${r.output ? ` ${r.output}` : ''}`,
    trace: r.trace,
    calculatorId: r.calculatorId,
    calculatorVersion: r.calculatorVersion,
    missing: r.missing,
    noTraceReason: r.trace.length ? null : NO_TRACE_RUN,
  }));
  return [...lines, ...calculators];
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The plant variable a trace input was read from, or null. The backend words the source of a variable input in one place
 * (variableProvider in sand-seeds.ts): "Sand casting variable NAME (unit)", or "Your value for sand casting variable NAME ...: the plant
 * value is V" once the part has its own value.
 */
export function variableOfSource(source: string | undefined): string | null {
  const m = /^(?:Sand|Your value for sand) casting variable ([A-Za-z][A-Za-z0-9_]*)/.exec(source ?? '');
  return m?.[1] ?? null;
}

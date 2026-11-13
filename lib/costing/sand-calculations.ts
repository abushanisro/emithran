import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

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

/** One calculator run behind the sand-casting cost, with the trace behind its number. */
export interface CalculationEntry {
  key: string;
  title: string;
  /** The headline figure, already worded ("3.2 kg"); null when the calculator gave none. */
  result: string | null;
  trace: CalculationTraceStep[];
  calculatorId: string | null;
  calculatorVersion: number | null;
  /** Inputs the calculator could not resolve. */
  missing: string[];
  /** Why there is no trace to show; null when there is one. */
  noTraceReason: string | null;
}

/** The route's calculator runs by where they are shown: the core boxes under Tooling, the metal, gating, risers and core sand under the material. */
export function splitSandRuns(runs: Record<string, CalculatorRun> | undefined): { material: Record<string, CalculatorRun>; tooling: Record<string, CalculatorRun> } {
  const material: Record<string, CalculatorRun> = {};
  const tooling: Record<string, CalculatorRun> = {};
  for (const [key, run] of Object.entries(runs ?? {})) (key.startsWith('Sand core box') ? tooling : material)[key] = run;
  return { material, tooling };
}

/** The calculator runs of the route (metal, risers, gating, core sand, core boxes), each carrying only what the backend sent. */
export function calculatorRunEntries(runs: Record<string, CalculatorRun> | undefined): CalculationEntry[] {
  return Object.entries(runs ?? {}).map(([name, r]) => ({
    key: `run:${name}`,
    title: r.name || name,
    result: r.value == null ? null : `${round(r.value)}${r.output ? ` ${r.output}` : ''}`,
    trace: r.trace,
    calculatorId: r.calculatorId,
    calculatorVersion: r.calculatorVersion,
    missing: r.missing,
    noTraceReason: r.trace.length ? null : 'The calculator returned no trace.',
  }));
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

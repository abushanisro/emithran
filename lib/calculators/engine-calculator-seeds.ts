import type { SourceRef } from './input-source';
// Per calculator, the inputs the cost engine gave it on this part: values,
// their sources and the lookup rows used — read from process lines'
// calculation traces. The first line WITH a trace wins for each calculator;
// a line with only a calculator id (an applied route's line) is skipped, so
// it can never hide the cost summary's traced line for the same calculator.
export interface EngineCalculatorSeed {
  calculatorId: string;
  inputs: Record<string, number | string>;
  provenance: Record<string, string>;
  /** Inputs measured on CAD faces -> which measurement (see backend cad-evidence.ts). */
  evidence: Record<string, string>;
  lookupMatches: Record<string, { table: string; row: Record<string, string | number> }>;
  /** Where each input was read (SourceRef), for the eye beside it. */
  refs: Record<string, SourceRef>;
}

type TraceStep = { kind: string; fieldName: string; value: unknown; source?: string | null; evidence?: string | null; ref?: SourceRef | null; group?: string | null; groupField?: string | null };

/**
 * The input steps a calculator is filled from, under the calculator's own field names. A line that ran the calculator once per group (a thread
 * size, a hole diameter: "M2 · Thread Diameter", "M3 · Thread Diameter") fills it from its first group, and every source says which group of
 * how many; the other groups stay in the line's trace.
 */
export function calculatorInputSteps(trace: readonly TraceStep[]): TraceStep[] {
  const inputs = trace.filter((st) => st.kind === 'input' && st.value !== null && st.value !== undefined);
  const groups = [...new Set(inputs.map((st) => st.group).filter((g): g is string => !!g))];
  if (groups.length === 0) return inputs;
  const first = groups[0]!;
  const note = groups.length > 1 ? ` — ${first}, the first of ${groups.length} groups (${groups.join(', ')})` : ` — ${first}`;
  return inputs
    .filter((st) => !st.group || st.group === first)
    .map((st) => (st.group ? { ...st, fieldName: st.groupField ?? st.fieldName, ...(st.source ? { source: `${st.source}${note}` } : {}) } : st));
}

interface TracedLine {
  calculatorId?: string | null;
  calculationTrace?: TraceStep[] | null;
  lookupMatches?: EngineCalculatorSeed['lookupMatches'] | null;
}

export function buildEngineCalculatorSeeds(lines: readonly TracedLine[]): Record<string, EngineCalculatorSeed> {
  const out: Record<string, EngineCalculatorSeed> = {};
  for (const line of lines) {
    if (!line.calculatorId || !line.calculationTrace?.length || out[line.calculatorId]) continue;
    const inputs = calculatorInputSteps(line.calculationTrace);
    out[line.calculatorId] = {
      calculatorId: line.calculatorId,
      inputs: Object.fromEntries(inputs.map((st) => [st.fieldName, st.value as number | string])),
      provenance: Object.fromEntries(inputs.flatMap((st) => (st.source ? [[st.fieldName, st.source]] : []))),
      evidence: Object.fromEntries(inputs.flatMap((st) => (st.evidence ? [[st.fieldName, st.evidence]] : []))),
      lookupMatches: line.lookupMatches ?? {},
      refs: Object.fromEntries(inputs.flatMap((st) => (st.ref ? [[st.fieldName, st.ref]] : []))),
    };
  }
  return out;
}

import type { CalculationTraceStep, CalculatorRunDto, ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import type { LookupMatch } from './reference-calculator';

/**
 * The inputs a calculator dialog shows for a part, taken from the run the cost
 * engine itself made: every input value with its source, the lookup-table rows
 * behind them, and what the engine could not resolve. The dialog therefore
 * shows the very numbers the quote was computed from, never a re-derivation.
 */
export interface CalculatorInputsDto {
  calculatorId: string;
  /** Catalog operation / calculator key the calculator is mapped to ("Drilling", "Net Material Usage", ...). */
  operation: string;
  /** Process group of the calculator mapping ("Machining", "Die Casting"). */
  processGroup?: string;
  /** Machining: the material class its lookup rows were chosen for. */
  materialClass?: string;
  /** Input field name → value. */
  inputs: Record<string, number>;
  /** Input field name → where the value came from. */
  provenance: Record<string, string>;
  /** Input field name → the lookup-table row(s) the value came from. */
  lookupMatches: Record<string, LookupMatch>;
  /** Inputs that could not be resolved, each with the reason. */
  missing: string[];
  /** Which engine run the inputs are from ("Die Size", "Slide 2", a process line). */
  run?: string;
}

/** One calculator run of a costed part: a process line or a summary calculatorRuns entry. */
interface EngineCalculatorRun {
  key: string;
  trace: CalculationTraceStep[];
  lookupMatches: Record<string, LookupMatch>;
  missing: string[];
}

/**
 * Every run of `calculatorId` in a costed part: its process lines, then the
 * summary calculatorRuns (material usage, die tooling, trim force, ...).
 */
export function engineRunsOf(
  calculatorId: string,
  processLines: readonly ProcessLineCost[],
  calculatorRuns: Record<string, CalculatorRunDto> | undefined,
): EngineCalculatorRun[] {
  const lines = processLines
    .filter((l) => l.calculatorId === calculatorId && l.calculationTrace?.length)
    .map((l) => ({ key: l.process, trace: l.calculationTrace!, lookupMatches: l.lookupMatches ?? {}, missing: l.physicsGap ? [physicsGapReason(l)] : [] }));
  const runs = Object.entries(calculatorRuns ?? {})
    .filter(([, r]) => r.calculatorId === calculatorId)
    .map(([key, r]) => ({ key, trace: r.trace, lookupMatches: r.lookupMatches, missing: r.missing }));
  return [...lines, ...runs];
}

function physicsGapReason(l: ProcessLineCost): string {
  const g = l.physicsGap;
  return g && 'reason' in g ? g.reason : `${l.process}: not costed`;
}

/**
 * The input steps of one engine run, restricted to the calculator's own input
 * fields. A run whose inputs were incomplete keeps the inputs it had and names
 * the rest in `missing`.
 */
export function inputsOfRun(run: EngineCalculatorRun, inputFields: ReadonlySet<string>): Pick<CalculatorInputsDto, 'inputs' | 'provenance' | 'lookupMatches' | 'missing'> {
  const inputs: Record<string, number> = {};
  const provenance: Record<string, string> = {};
  const lookupMatches: Record<string, LookupMatch> = {};
  for (const st of run.trace) {
    if (st.kind !== 'input' || typeof st.value !== 'number' || !inputFields.has(st.fieldName)) continue;
    inputs[st.fieldName] = st.value;
    provenance[st.fieldName] = st.source ?? 'Cost engine';
    const m = run.lookupMatches[st.fieldName];
    if (m) lookupMatches[st.fieldName] = m;
  }
  return { inputs, provenance, lookupMatches, missing: [...run.missing] };
}

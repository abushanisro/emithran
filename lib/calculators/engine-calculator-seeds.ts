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
}

interface TracedLine {
  calculatorId?: string | null;
  calculationTrace?: { kind: string; fieldName: string; value: unknown; source?: string | null; evidence?: string | null }[] | null;
  lookupMatches?: EngineCalculatorSeed['lookupMatches'] | null;
}

export function buildEngineCalculatorSeeds(lines: readonly TracedLine[]): Record<string, EngineCalculatorSeed> {
  const out: Record<string, EngineCalculatorSeed> = {};
  for (const line of lines) {
    if (!line.calculatorId || !line.calculationTrace?.length || out[line.calculatorId]) continue;
    const inputs = line.calculationTrace.filter((st) => st.kind === 'input' && st.value !== null && st.value !== undefined);
    out[line.calculatorId] = {
      calculatorId: line.calculatorId,
      inputs: Object.fromEntries(inputs.map((st) => [st.fieldName, st.value as number | string])),
      provenance: Object.fromEntries(inputs.flatMap((st) => (st.source ? [[st.fieldName, st.source]] : []))),
      evidence: Object.fromEntries(inputs.flatMap((st) => (st.evidence ? [[st.fieldName, st.evidence]] : []))),
      lookupMatches: line.lookupMatches ?? {},
    };
  }
  return out;
}

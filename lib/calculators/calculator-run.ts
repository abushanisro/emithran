// The calculation behind a process line's cycle time: the stored calculator that computed it and its run (the ordered trace of inputs and
// calculated fields, and the reference-table row each lookup input came from). A live engine line carries it (calculatorId,
// calculationTrace, lookupMatches); a saved line keeps it (process_cost_records calculator_id / calculator_version / calculator_run,
// migration 1097). The Edit Process Cost calculator opens on it, and saving a cycle computed in that calculator keeps its run. Pure.
import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

import { buildEngineCalculatorSeeds, type EngineCalculatorSeed } from './engine-calculator-seeds';

import type { SourceRef } from './input-source';

export interface LookupMatch {
  table: string;
  row: Record<string, string | number>;
}

/** process_cost_records.calculator_run. */
export interface CalculatorRun {
  trace: CalculationTraceStep[];
  lookupMatches: Record<string, LookupMatch>;
}

/** What a saved line keeps of the calculation behind its cycle; every field null for a typed cycle. */
export interface LineCalculation {
  calculatorId: string | null;
  calculatorVersion: number | null;
  calculatorRun: CalculatorRun | null;
}

export const NO_CALCULATION: LineCalculation = { calculatorId: null, calculatorVersion: null, calculatorRun: null };

/** A live engine line's calculation, in the shape a saved line keeps it. Null when the line has none (no trace). */
export function calculationOfLine(line: {
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  calculationTrace?: readonly CalculationTraceStep[] | null;
  lookupMatches?: Record<string, LookupMatch> | null;
} | null | undefined): LineCalculation | null {
  if (!line?.calculationTrace?.length) return null;
  return {
    calculatorId: line.calculatorId ?? null,
    calculatorVersion: line.calculatorId ? line.calculatorVersion ?? null : null,
    calculatorRun: { trace: [...line.calculationTrace], lookupMatches: line.lookupMatches ?? {} },
  };
}

/** A saved line's calculation, when it kept one. */
export function calculationOfRecord(record: Partial<LineCalculation> | null | undefined): LineCalculation | null {
  if (!record?.calculatorRun?.trace.length) return null;
  return { calculatorId: record.calculatorId ?? null, calculatorVersion: record.calculatorVersion ?? null, calculatorRun: record.calculatorRun };
}

/** A calculation as the traced line the calculator seeds are read from (engine-calculator-seeds.ts); null when it has no run. */
export function tracedLineOf(calculation: LineCalculation | null | undefined): { calculatorId: string | null; calculationTrace: CalculationTraceStep[]; lookupMatches: Record<string, LookupMatch> } | null {
  if (!calculation?.calculatorRun) return null;
  return { calculatorId: calculation.calculatorId, calculationTrace: calculation.calculatorRun.trace, lookupMatches: calculation.calculatorRun.lookupMatches };
}

/** The calculator inputs a calculation was run with (values, sources, CAD evidence, lookup rows), to open its calculator on. */
export function seedOfCalculation(calculation: LineCalculation | null | undefined): EngineCalculatorSeed | undefined {
  const line = tracedLineOf(calculation);
  return line?.calculatorId ? buildEngineCalculatorSeeds([line])[line.calculatorId] : undefined;
}

/** A calculator field as the dialog has it (lib/api/calculators.ts CalculatorField): a calculated field's formula is its default value. */
interface RunField {
  fieldName: string;
  displayLabel?: string | null;
  fieldType: string;
  unit?: string | null;
  defaultValue?: string | null;
  displayOrder?: number | null;
}

/**
 * The run of a calculator in the dialog, as a saved line keeps it: every field in display order, an input with the value it was given and
 * where that came from, a calculated field with its formula and result. Lookup rows are kept for the inputs that have one.
 */
export function runOfCalculator(args: {
  fields: readonly RunField[];
  inputs: Readonly<Record<string, unknown>>;
  results: Readonly<Record<string, unknown>> | null;
  provenance: Readonly<Record<string, string>>;
  evidence?: Readonly<Record<string, string>>;
  refs?: Readonly<Record<string, SourceRef | null>>;
  lookupMatches?: Readonly<Record<string, LookupMatch>>;
}): CalculatorRun {
  const valueOf = (v: unknown): number | string | null =>
    typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' && v.trim() !== '' ? (Number.isFinite(Number(v)) ? Number(v) : v) : null;
  const ordered = [...args.fields].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  const trace = ordered.map((f): CalculationTraceStep => {
    const base = { fieldName: f.fieldName, displayLabel: f.displayLabel ?? f.fieldName, unit: f.unit ?? null };
    if (f.fieldType === 'calculated') {
      return { ...base, kind: 'calculated', value: valueOf(args.results?.[f.fieldName]), ...(f.defaultValue ? { formula: f.defaultValue } : {}) };
    }
    const source = args.provenance[f.fieldName];
    const evidence = args.evidence?.[f.fieldName];
    const ref = args.refs?.[f.fieldName];
    return {
      ...base, kind: 'input', value: valueOf(args.inputs[f.fieldName]),
      ...(source ? { source } : {}), ...(evidence ? { evidence } : {}), ...(ref ? { ref } : {}),
    };
  });
  const inputNames = new Set(trace.filter((s) => s.kind === 'input').map((s) => s.fieldName));
  const lookupMatches = Object.fromEntries(Object.entries(args.lookupMatches ?? {}).filter(([field]) => inputNames.has(field)));
  return { trace, lookupMatches };
}

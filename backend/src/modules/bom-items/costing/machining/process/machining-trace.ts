import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';

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
  return trace.map((s) => ({ ...s, fieldName: `${prefix} ${s.fieldName}`, displayLabel: `${prefix} ${s.displayLabel}` }));
}

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
}

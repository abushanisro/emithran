import type { CalculationTraceStep, SourceRef } from '../../../dto/cost-breakdown.dto';
import type { CalcSeed, LookupMatch } from './machining-calculator';

/**
 * Where a machining calculator input was read, as the structured SourceRef the calculator dialog's eye opens. The machining tables and
 * variables are the reference-data domain `machining` (processes/reference-domains.ts: machining_reference_data at the machining source
 * version), so a lookup input opens through the same GET /processes/reference-lookup every domain uses, and a variable through
 * GET /processes/variables. A seed's `match` (the row it came from) is the ref's row; `column` is the flattened table's column the value is in
 * (machining-lookup-tables.ts flattenMachiningLookupTable, the shape that endpoint serves).
 */
export const MACHINING_REFERENCE_DOMAIN = 'machining';

/** The pseudo-table name the machining seeds use for a variable (`match: { table: 'variables', row: { key } }`). */
const VARIABLES_TABLE = 'variables';

/** The ref of a value read from one row of a machining table (or a machining variable, when the match names one). */
export function machiningLookupRef(match: LookupMatch, column: string): SourceRef {
  if (match.table === VARIABLES_TABLE && typeof match.row.key === 'string') {
    return { kind: 'variable', domain: MACHINING_REFERENCE_DOMAIN, name: match.row.key };
  }
  return { kind: 'lookup', domain: MACHINING_REFERENCE_DOMAIN, table: match.table, column, row: match.row };
}

/** The columns of a table row that identify it, as a match row (a column the row has no scalar value in is left out). */
export function rowKeys(row: Record<string, unknown>, columns: readonly string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const c of columns) {
    const v = row[c];
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[c] = v;
  }
  return out;
}

/** A seed read from one row of a machining table: its value, source, the row (legacy `match`) and the ref the dialog opens. */
export function lookupSeed(value: number, source: string, match: LookupMatch, column: string): CalcSeed {
  return { value, source, lookup: true, match, ref: machiningLookupRef(match, column) };
}

/** A seed read from a machining variable (machining_reference_data category 'variable'). */
export function variableSeed(value: number, key: string): CalcSeed {
  return lookupSeed(value, `variables: ${key}`, { table: VARIABLES_TABLE, row: { key } }, 'value');
}

/** One input step of a calculation ref, from the seed it was read as. */
export function seedStep(label: string, unit: string | null, seed: CalcSeed): CalculationTraceStep {
  return {
    fieldName: label, displayLabel: unit ? `${label} (${unit})` : label, kind: 'input', value: round(seed.value), unit, source: seed.source,
    ...(seed.lookup ? { stepType: 'lookup' as const } : {}),
    ...(seed.ref ? { ref: seed.ref } : {}),
  };
}

/** The calculated step a calculation ref ends with: its formula over the steps before it and the value it gave. */
export function resultStep(label: string, unit: string | null, value: number, formula: string): CalculationTraceStep {
  return { fieldName: label, displayLabel: unit ? `${label} (${unit})` : label, kind: 'calculated', value: round(value), unit, formula, stepType: 'physics' };
}

/** A value the engine computed from other values (each with its own source), as the calculation the dialog shows step by step. */
export function calculationRef(name: string, steps: CalculationTraceStep[]): SourceRef {
  return { kind: 'calculation', name, evidence: null, steps };
}

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
}

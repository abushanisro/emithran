// The calculation behind a line's cycle time, as process_cost_records keeps it (migration 1097): the stored calculator that ran it
// (calculator_id, calculator_version), the run itself (calculator_run: the ordered trace and the reference-table row each lookup input came
// from) and the cycle's phases read off that trace (cycle_phases, migration 1009). Pure.
//
// The engine line carries all of it (ProcessLineCost.calculatorId / calculatorVersion / calculationTrace / lookupMatches). Persisting it is
// what lets a saved line reopen its own calculator with the inputs it was costed from, instead of a calculator guessed from the process
// catalog and opened empty; and it is the same run read back onto a line rebuilt from its row (cost-engine.ts buildLineFromAppliedRecord).
import { cyclePhasesOf, type CyclePhase } from './cycle-phases';

import type { CalculationTraceStep, ProcessLineCost } from '../../dto/cost-breakdown.dto';

export type LookupMatches = NonNullable<ProcessLineCost['lookupMatches']>;

/** process_cost_records.calculator_run. */
export interface PersistedCalculatorRun {
  trace: CalculationTraceStep[];
  lookupMatches: LookupMatches;
}

/** The calculation columns of a process_cost_records row. */
export interface CalculatorRunColumns {
  calculator_id: string | null;
  calculator_version: number | null;
  calculator_run: PersistedCalculatorRun | null;
  cycle_phases: CyclePhase[] | null;
}

/** The line fields a calculation is read from. */
export type CalculatedLine = Pick<ProcessLineCost, 'calculatorId' | 'calculatorVersion' | 'calculationTrace' | 'lookupMatches'>;

/** calculator_id is a uuid column referencing calculators(id). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** No calculation: a typed cycle, or a line no calculator computed. */
export const NO_CALCULATION: Readonly<CalculatorRunColumns> = Object.freeze({
  calculator_id: null, calculator_version: null, calculator_run: null, cycle_phases: null,
});

/**
 * A line's calculation, for its row. The run is kept whenever the line has a trace (what the cycle was computed from is worth keeping even
 * when no stored calculator ran it); the calculator only when it is a stored one, and its version only with it.
 */
export function calculatorRunColumns(line: CalculatedLine): CalculatorRunColumns {
  const trace = line.calculationTrace?.length ? line.calculationTrace : null;
  const calculatorId = typeof line.calculatorId === 'string' && UUID.test(line.calculatorId) ? line.calculatorId : null;
  const version = line.calculatorVersion;
  return {
    calculator_id: calculatorId,
    calculator_version: calculatorId && version != null && Number.isInteger(version) ? version : null,
    calculator_run: trace ? { trace, lookupMatches: line.lookupMatches ?? {} } : null,
    cycle_phases: cyclePhasesOf(trace),
  };
}

/** A row's calculation read back onto its line: the same fields the engine line had, absent when the row has none. */
export function calculationOfRow(row: {
  calculator_id?: string | null;
  calculator_version?: number | null;
  calculator_run?: unknown;
}): CalculatedLine {
  const run = asPersistedRun(row.calculator_run);
  return {
    ...(row.calculator_id ? { calculatorId: row.calculator_id } : {}),
    ...(row.calculator_id && row.calculator_version != null ? { calculatorVersion: row.calculator_version } : {}),
    ...(run ? { calculationTrace: run.trace } : {}),
    ...(run && Object.keys(run.lookupMatches).length > 0 ? { lookupMatches: run.lookupMatches } : {}),
  };
}

/** A stored calculator_run, when it is one (the column's CHECK guarantees an object with a trace array; older rows have none). */
function asPersistedRun(value: unknown): PersistedCalculatorRun | null {
  if (!value || typeof value !== 'object') return null;
  const { trace, lookupMatches } = value as { trace?: unknown; lookupMatches?: unknown };
  if (!Array.isArray(trace) || trace.length === 0) return null;
  return {
    trace: trace as CalculationTraceStep[],
    lookupMatches: lookupMatches && typeof lookupMatches === 'object' && !Array.isArray(lookupMatches) ? lookupMatches as LookupMatches : {},
  };
}

// ── A run sent by a client ──────────────────────────────────────────────────
//
// The Edit Process Cost dialog saves the run its calculator computed the cycle with (the same shape: a trace and lookup rows), so the line
// reopens that calculator with those inputs. It is client data: reduced here to the persisted shape, every text capped, nothing else kept.

const MAX_STEPS = 400;
const MAX_TEXT = 2000;
const MAX_REF_JSON = 4000;
const STEP_TEXT_KEYS = ['unit', 'source', 'formula', 'evidence', 'group', 'groupField'] as const;

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, MAX_TEXT) : undefined);
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function stepFromClient(raw: unknown): CalculationTraceStep | null {
  if (!isPlainObject(raw)) return null;
  const fieldName = text(raw.fieldName);
  const kind = raw.kind === 'input' || raw.kind === 'calculated' ? raw.kind : null;
  if (!fieldName || !kind) return null;
  const value = typeof raw.value === 'number' ? (Number.isFinite(raw.value) ? raw.value : null) : (text(raw.value) ?? null);
  const step: CalculationTraceStep = { fieldName, displayLabel: text(raw.displayLabel) ?? fieldName, kind, value };
  for (const key of STEP_TEXT_KEYS) {
    const v = text(raw[key]);
    if (v !== undefined) (step as unknown as Record<string, string>)[key] = v;
  }
  if (raw.stepType === 'physics' || raw.stepType === 'lookup') step.stepType = raw.stepType;
  if (isPlainObject(raw.ref) && JSON.stringify(raw.ref).length <= MAX_REF_JSON) step.ref = raw.ref as unknown as CalculationTraceStep['ref'];
  return step;
}

function lookupMatchesFromClient(raw: unknown): LookupMatches {
  if (!isPlainObject(raw)) return {};
  const out: LookupMatches = {};
  for (const [field, match] of Object.entries(raw).slice(0, MAX_STEPS)) {
    const table = isPlainObject(match) ? text(match.table) : undefined;
    if (!isPlainObject(match) || !table || !isPlainObject(match.row)) continue;
    const row = Object.fromEntries(Object.entries(match.row).flatMap(([k, v]): [string, string | number][] =>
      (typeof v === 'number' && Number.isFinite(v) ? [[k, v]] : typeof v === 'string' ? [[k, v.slice(0, MAX_TEXT)]] : [])));
    out[field.slice(0, MAX_TEXT)] = { table, row };
  }
  return out;
}

/** The calculation columns for a cycle a client computed with a stored calculator; no calculation when it sent none (a typed cycle). */
export function calculatorColumnsFromClient(input: { calculatorId?: unknown; calculatorVersion?: unknown; calculatorRun?: unknown }): CalculatorRunColumns {
  const run = isPlainObject(input.calculatorRun) ? input.calculatorRun : null;
  const steps: unknown[] = Array.isArray(run?.trace) ? run.trace : [];
  const trace = steps.slice(0, MAX_STEPS).map(stepFromClient).filter((s): s is CalculationTraceStep => s != null);
  return calculatorRunColumns({
    calculatorId: typeof input.calculatorId === 'string' ? input.calculatorId : undefined,
    calculatorVersion: typeof input.calculatorVersion === 'number' ? input.calculatorVersion : undefined,
    calculationTrace: trace,
    lookupMatches: lookupMatchesFromClient(run?.lookupMatches),
  });
}

import {
  evaluateCalculatorFormulas,
  normalizeFieldName,
  type CalculatorFieldRow,
} from '../../../../calculators/calculator-formula-evaluator';
import type { CalculationTraceStep, SourceRef } from '../../../dto/cost-breakdown.dto';

/**
 * Reference-data calculators (Machining, Die Casting, ...) are computed BY the
 * database calculators (calculators / calculator_fields, wired per operation in
 * process_calculator_mappings, generated from each domain's calculator spec).
 * The engine never holds the formula: it supplies each calculator's inputs (CAD
 * measurements, alloy and machine values, reference variables and lookup-table
 * rows, each with its source) and evaluates the calculator's own stored
 * formulas with the same evaluator the cost dialogs run
 * (calculator-formula-evaluator.ts), so the quote and the dialogs cannot
 * disagree.
 */
export interface ReferenceCalculatorField {
  field_name: string;
  display_label?: string | null;
  field_type: string;
  default_value?: string | number | null;
  unit?: string | null;
  display_order?: number | null;
  data_source?: string | null;
  source_table?: string | null;
  source_field?: string | null;
}

export interface ReferenceCalculatorDef {
  calculatorId: string;
  name: string;
  version: number;
  fields: ReferenceCalculatorField[];
  /** A part's own values for some of its fields, by field name (calculator_field_overrides, migration 1011): set with withFieldOverrides. */
  overrides?: Readonly<Record<string, FieldOverride>>;
}

/** A part's own value for one calculator field, with the reason (calculator_field_overrides). */
export interface FieldOverride {
  value: number;
  reason: string;
}

/** Per calculator name, the part's own field values. */
export type CalculatorFieldOverrides = Readonly<Record<string, Readonly<Record<string, FieldOverride>>>>;

/**
 * The calculators with a part's own field values laid over them, for one calculation. The stored definitions are never edited: a calculator with
 * overrides is a copy, the others are the same objects. No overrides: the calculators as given.
 */
export function withFieldOverrides(calculators: ReferenceCalculators | null | undefined, overrides: CalculatorFieldOverrides | null | undefined): ReferenceCalculators | null | undefined {
  if (!calculators || !overrides || Object.keys(overrides).length === 0) return calculators;
  return Object.fromEntries(Object.entries(calculators).map(([key, def]) => {
    const own = overrides[def.name];
    return [key, own && Object.keys(own).length > 0 ? { ...def, overrides: own } : def];
  }));
}

const overrideSource = (o: FieldOverride, was: string) => `Engineer's value for this part: ${o.reason} (instead of ${was})`;

/** Calculator per operation / calculator key ("Drilling", "High Pressure Die Casting", ...). */
export type ReferenceCalculators = Record<string, ReferenceCalculatorDef>;

/** One input value the engine supplies, with where it came from. */
export interface CalcSeed {
  value: number;
  source: string;
  /** True when the value is a row of a reference lookup table. */
  lookup?: boolean;
  /** Which lookup-table row(s) the value came from: every column/value in `row` identifies them. */
  match?: LookupMatch;
  /** Where the value was read, structured, so the calculator dialog can open and highlight it (SourceRef). */
  ref?: SourceRef;
}

/** The lookup-table row(s) an input came from, for highlighting in the table viewer. */
export interface LookupMatch {
  table: string;
  row: Record<string, string | number>;
}

/** The CAD faces a source rests on: a CAD measurement, or a calculation over one (Poured Weight over the part volume). */
function evidenceOf(ref: SourceRef): CalculationTraceStep['evidence'] | null {
  if (ref.kind === 'cad') return ref.evidence;
  if (ref.kind === 'calculation') return ref.evidence;
  return null;
}

export interface CalcRun {
  /** The calculator's "Cycle Time" (s), or its declared output; null when an input or the calculator is missing. */
  sec: number | null;
  trace: CalculationTraceStep[];
  /** Missing real inputs (or the missing calculator), for the line's gap. */
  missing: string[];
  calculatorId: string | null;
  calculatorVersion: number | null;
  /** Per input field, the lookup-table row(s) its value came from. */
  lookups: Record<string, LookupMatch>;
}

/** A run with its declared output and every calculated field's value (secondary outputs: a force, a scrap %). */
export interface ReferenceCalcRun extends CalcRun {
  value: number | null;
  outputs: Record<string, number>;
}

export const CYCLE_TIME_FIELD = 'Cycle Time';

const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '';

export function runReferenceCalculator(
  calculators: ReferenceCalculators | null | undefined,
  operation: string,
  seeds: Record<string, CalcSeed>,
  outputField: string = CYCLE_TIME_FIELD,
): ReferenceCalcRun {
  const def = calculators?.[operation];
  if (!def) {
    return {
      value: null, sec: null, outputs: {}, trace: [], calculatorId: null, calculatorVersion: null, lookups: {},
      missing: [`a calculator for "${operation}" (none mapped in process_calculator_mappings)`],
    };
  }

  const ordered = [...def.fields].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  const inputs: CalculationTraceStep[] = [];
  const scope: Record<string, number> = {};
  const missingInputs: string[] = [];
  const lookups: Record<string, LookupMatch> = {};

  for (const f of ordered) {
    if (f.field_type === 'calculated') continue;
    const own = def.overrides?.[f.field_name];
    const seeded = seeds[f.field_name];
    const seed: CalcSeed | undefined = own
      ? { value: own.value, source: overrideSource(own, seeded ? `${round(seeded.value)}, ${seeded.source}` : 'no seeded value') }
      : seeded;
    if (seed && Number.isFinite(seed.value)) {
      scope[f.field_name] = seed.value;
      if (seed.match) lookups[f.field_name] = seed.match;
      inputs.push({
        fieldName: f.field_name, displayLabel: f.display_label ?? f.field_name, kind: 'input',
        value: round(seed.value), unit: f.unit ?? null, source: seed.source,
        ...(seed.lookup ? { stepType: 'lookup' as const } : {}),
        // A value the part's own override replaced was not read from the seed's source: no ref then.
        ...(seed.ref && !own ? { ref: seed.ref, ...(evidenceOf(seed.ref) ? { evidence: evidenceOf(seed.ref)! } : {}) } : {}),
        ...(own ? { override: { original: seeded && Number.isFinite(seeded.value) ? round(seeded.value) : null, reason: own.reason } } : {}),
      });
    } else if (hasValue(f.default_value) && Number.isFinite(Number(f.default_value))) {
      scope[f.field_name] = Number(f.default_value);
      inputs.push({
        fieldName: f.field_name, displayLabel: f.display_label ?? f.field_name, kind: 'input',
        value: Number(f.default_value), unit: f.unit ?? null,
        source: `Assumption: ${def.name} default value (database) — no reference source`,
      });
    } else {
      missingInputs.push(f.field_name);
    }
  }

  const base = { calculatorId: def.calculatorId, calculatorVersion: def.version, lookups };
  if (missingInputs.length > 0) {
    return { ...base, value: null, sec: null, outputs: {}, trace: inputs, missing: [`${operation}: ${missingInputs.join(', ')}`] };
  }

  const rows: CalculatorFieldRow[] = ordered.map((f) => ({
    id: f.field_name, field_name: f.field_name, field_type: f.field_type,
    default_value: f.default_value ?? null, display_order: f.display_order ?? null,
  }));
  // A calculated field the part sets is evaluated first as the calculator states it (the trace shows what it would have been), then fixed at the part's
  // value as an input, so every later formula uses it.
  const calcOverrides = ordered.filter((f) => f.field_type === 'calculated' && def.overrides?.[f.field_name]);
  const stated = calcOverrides.length > 0 ? evaluateCalculatorFormulas(rows, [], { ...scope }).scope : null;
  const fixed = Object.fromEntries(calcOverrides.map((f) => [f.field_name, def.overrides![f.field_name]!.value]));
  const { scope: out } = evaluateCalculatorFormulas(
    rows.map((r) => (r.field_name in fixed ? { ...r, field_type: 'number', default_value: null } : r)),
    [],
    { ...scope, ...fixed },
  );
  for (const [name, v] of Object.entries(fixed)) out[normalizeFieldName(name)] = v;

  const outputs: Record<string, number> = {};
  const formulas: CalculationTraceStep[] = ordered
    .filter((f) => f.field_type === 'calculated')
    .map((f) => {
      const v = out[normalizeFieldName(f.field_name)];
      const finite = typeof v === 'number' && Number.isFinite(v);
      if (finite) outputs[f.field_name] = v as number;
      const own = def.overrides?.[f.field_name];
      const was = stated?.[normalizeFieldName(f.field_name)];
      return {
        fieldName: f.field_name, displayLabel: f.display_label ?? f.field_name, kind: 'calculated' as const,
        value: finite ? round(v as number) : null,
        unit: f.unit ?? null, formula: String(f.default_value ?? ''), stepType: 'physics' as const,
        ...(own ? { source: overrideSource(own, 'the formula'), override: { original: typeof was === 'number' && Number.isFinite(was) ? round(was) : null, reason: own.reason } } : {}),
      };
    });

  const value = out[normalizeFieldName(outputField)];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return {
      ...base, value: null, sec: null, outputs, trace: [...inputs, ...formulas],
      missing: [`${def.name} produced no finite ${outputField.toLowerCase()} from these inputs`],
    };
  }
  return { ...base, value, sec: value, outputs, trace: [...inputs, ...formulas], missing: [] };
}

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 10000) / 10000;
}

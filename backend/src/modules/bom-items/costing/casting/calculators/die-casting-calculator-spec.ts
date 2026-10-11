import spec from './die-casting-calculators.json';
import type { ReferenceCalculatorField, ReferenceCalculators } from '../../shared/calculators/reference-calculator';

/**
 * The die-casting calculator spec (die-casting-calculators.json): every value
 * the die-casting costing computes, as a database calculator. Read by the
 * migration generator (scripts/generate-die-casting-calculators-migration.ts)
 * and by tests; the running engine reads the calculators from the database
 * (bom-items.service.ts resolveCastingCalculators), keyed by `key`.
 *
 * Field sources:
 *   cad         a cad-engine measurement on the part
 *   alloy       the alloy's materials_master column (raw_materials + properties)
 *   machine     the selected machine's HR Rates spec key
 *   variable    a memory/Die Casting variable (column = variable name)
 *   lookup      a memory/Die Casting lookup-table row (table, column)
 *   bom         the scenario inputs (batch size, annual volume, production life)
 *   engine      decided by the engine (cavities, layout, which gates are ground)
 *   calculator  another calculator's output (`from` = its key)
 */
type DieCastingFieldSource = 'cad' | 'alloy' | 'machine' | 'variable' | 'lookup' | 'bom' | 'engine' | 'calculator';

interface DieCastingSpecField {
  name: string;
  unit: string | null;
  source?: DieCastingFieldSource;
  table?: string;
  column?: string;
  /** Other tables / columns the same input is read from (the trace names the one used). */
  alsoTables?: string[];
  alsoColumns?: string[];
  /** For a `calculator` field: the key of the calculator whose output it is. */
  from?: string;
  formula?: string;
}

interface DieCastingSpecCalculator {
  name: string;
  key: string;
  category: 'material' | 'process' | 'tooling';
  output: string;
  description: string;
  fields: DieCastingSpecField[];
}

export interface DieCastingCalculatorSpec {
  processGroup: string;
  domain: string;
  calculators: DieCastingSpecCalculator[];
}

/** The calculator_fields.data_source of a die-casting reference input. */
export const CASTING_LOOKUP_DATA_SOURCE = 'casting_lookup';
/** The pseudo tables the casting lookup viewer serves besides the lookup tables. */
export const CASTING_VARIABLES_TABLE = 'variables';
export const CASTING_MATERIALS_TABLE = 'materials_master';

export function loadDieCastingCalculatorSpec(): DieCastingCalculatorSpec {
  const raw = spec as unknown as DieCastingCalculatorSpec;
  const keys = new Set<string>();
  for (const c of raw.calculators) {
    if (keys.has(c.key)) throw new Error(`die-casting calculator key "${c.key}" is not unique`);
    keys.add(c.key);
    if (!c.fields.some((f) => f.name === c.output && f.formula)) {
      throw new Error(`die-casting calculator "${c.name}": output "${c.output}" is not one of its calculated fields`);
    }
  }
  for (const c of raw.calculators) {
    for (const f of c.fields) {
      if (f.source === 'calculator' && !keys.has(f.from ?? '')) {
        throw new Error(`die-casting calculator "${c.name}": field "${f.name}" names no calculator "${f.from}"`);
      }
    }
  }
  return raw;
}

/** A spec field as the calculator_fields row it becomes. */
export function dieCastingFieldToRow(f: DieCastingSpecField, order: number): ReferenceCalculatorField {
  const reference = f.source === 'lookup' || f.source === 'variable' || f.source === 'alloy';
  const table = f.source === 'variable' ? CASTING_VARIABLES_TABLE : f.source === 'alloy' ? CASTING_MATERIALS_TABLE : f.table ?? null;
  return {
    field_name: f.name,
    display_label: f.unit ? `${f.name} (${f.unit})` : f.name,
    field_type: f.formula ? 'calculated' : 'number',
    default_value: f.formula ?? null,
    unit: f.unit,
    display_order: order,
    data_source: reference ? CASTING_LOOKUP_DATA_SOURCE : f.source === 'machine' ? 'mhr' : null,
    source_table: reference ? table : null,
    source_field: reference || f.source === 'machine' ? f.column ?? null : null,
  };
}

/** The spec as the calculator set the engine receives, keyed by calculator key (ids are the spec names). */
export function dieCastingSpecAsCalculators(s: DieCastingCalculatorSpec = loadDieCastingCalculatorSpec()): ReferenceCalculators {
  return Object.fromEntries(s.calculators.map((c) => [c.key, {
    calculatorId: c.name, name: c.name, version: 1,
    fields: c.fields.map((f, i) => dieCastingFieldToRow(f, i + 1)),
  }]));
}

/** Every lookup table a die-casting calculator reads (the lookup viewer allow-list). */
export function dieCastingLookupTableNames(s: DieCastingCalculatorSpec = loadDieCastingCalculatorSpec()): string[] {
  const names = new Set<string>([CASTING_VARIABLES_TABLE, CASTING_MATERIALS_TABLE]);
  for (const c of s.calculators) {
    for (const f of c.fields) {
      if (f.source !== 'lookup') continue;
      if (f.table) names.add(f.table);
      for (const t of f.alsoTables ?? []) names.add(t);
    }
  }
  return [...names].sort();
}

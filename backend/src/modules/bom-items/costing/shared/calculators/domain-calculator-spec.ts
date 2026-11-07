import type { ReferenceCalculatorDef, ReferenceCalculatorField, ReferenceCalculators } from './reference-calculator';

/**
 * A domain's calculator spec (heat treatment, secondary processes, surface
 * treatment): one JSON file per domain, read by that domain's migration
 * generator, by its engine loader, and by tests. Machining and die casting keep
 * their own specs (their fields name lookup tables); this one is for domains
 * whose engine seeds every input itself and shows its source in the trace.
 */
/**
 * Where the engine takes an input's value from. Informational for the database (calculator_fields keeps no source); it is what a
 * generic seeder reads to supply the input, and what a test reads to prove every input has one. A calculated field has none.
 *   cad       a measurement of the part (key into the engine's measurements)
 *   material  a column of the part's material
 *   machine   a column of the step's machine
 *   variable  a named reference variable
 *   lookup    "table.column": the row the engine finds in a reference table
 *   scenario  a choice the user made for the part
 *   engine    a value the route decides (cores, cavities, ...)
 */
export type DomainFieldSource =
  | { cad: string }
  | { material: string }
  | { machine: string }
  | { variable: string }
  | { lookup: string }
  | { scenario: string }
  | { engine: string };

export interface DomainSpecField {
  name: string;
  unit: string | null;
  /** A formula over other fields, written {Field Name}; makes the field calculated. */
  formula?: string;
  /** Where an input (a field without a formula) comes from; see DomainFieldSource. */
  source?: DomainFieldSource;
  /**
   * The reference table an input is read from, for the cost dialog's eye button (calculator_fields.data_source, source_table, source_field). Opt-in per field: a field
   * without them is written as before (all three NULL), so the migrations generated for other domains do not change. data_source must be one the table allows
   * ('machining_lookup' = a table staged in machining_reference_data, whichever dataset).
   */
  dataSource?: string;
  sourceTable?: string;
  sourceField?: string;
}

export interface DomainSpecCalculator {
  /** Stable key, used in tests and logs. */
  key: string;
  /** Global calculator name in the database. */
  name: string;
  description: string;
  /**
   * Catalog operations (process_calculator_mappings.operation) this calculator computes. Empty only for a helper: a calculator no
   * operation maps to (a design or sizing step, or a variant the engine chooses by machine), found by its name.
   */
  operations: string[];
  /** True for a calculator that computes no catalog operation; required exactly when `operations` is empty. */
  helper?: boolean;
  /**
   * calculators.version, 1 when absent. A calculator already in use is never edited in place under the same version: a change to its fields or formulas raises this and
   * ships as a new migration for that calculator (calculators.version, migration 428: "bumped when a calculator's fields/formulas change").
   */
  version?: number;
  /** The migration that last wrote this calculator (a calculator in use is changed by a new migration, never by editing the one that created it). */
  migration?: number;
  /** The calculated field that is the calculator's result. Default "Cycle Time" (seconds), which an operation's calculator must have. */
  output?: string;
  /** Further calculated fields the engine reads besides the output (named in the spec, so the engine does not guess). */
  results?: string[];
  fields: DomainSpecField[];
}

/** The output field name a calculator without `output` has. */
export const DEFAULT_CALCULATOR_OUTPUT = 'Cycle Time';

export interface DomainCalculatorSpec {
  domain: string;
  /** process_calculator_mappings.process_group of the operations. */
  processGroup: string;
  calculators: DomainSpecCalculator[];
}

const REFERENCE = /\{([^{}]+)\}/g;

/**
 * Validates a spec as written: unique calculator names and operations, unique
 * field names per calculator, every formula naming only fields of its own
 * calculator that come before it, and a "Cycle Time" field on each calculator.
 * Throws naming the first defect, so a bad spec fails at generation, not at quote time.
 */
export function validateDomainCalculatorSpec(raw: DomainCalculatorSpec): DomainCalculatorSpec {
  const names = new Set<string>();
  const operations = new Set<string>();
  for (const c of raw.calculators) {
    if (names.has(c.name)) throw new Error(`${raw.domain}: calculator "${c.name}" appears twice`);
    names.add(c.name);
    if (c.operations.length === 0 && c.helper !== true) throw new Error(`${raw.domain}: calculator "${c.name}" computes no operation and is not marked helper`);
    if (c.operations.length > 0 && c.helper === true) throw new Error(`${raw.domain}: calculator "${c.name}" is marked helper but computes operations`);
    for (const op of c.operations) {
      if (operations.has(op)) throw new Error(`${raw.domain}: operation "${op}" is computed by two calculators`);
      operations.add(op);
    }
    const seen = new Set<string>();
    for (const f of c.fields) {
      if (seen.has(f.name)) throw new Error(`${raw.domain}: "${c.name}" has field "${f.name}" twice`);
      for (const m of (f.formula ?? '').matchAll(REFERENCE)) {
        if (!seen.has(m[1]!)) throw new Error(`${raw.domain}: "${c.name}" field "${f.name}" uses {${m[1]}}, which is not an earlier field`);
      }
      seen.add(f.name);
    }
    const output = c.output ?? DEFAULT_CALCULATOR_OUTPUT;
    if (!c.fields.some((f) => f.name === output && f.formula)) {
      throw new Error(`${raw.domain}: "${c.name}" has no calculated "${output}" field`);
    }
    if (c.helper !== true && output !== DEFAULT_CALCULATOR_OUTPUT) {
      throw new Error(`${raw.domain}: "${c.name}" computes an operation, so its output must be "${DEFAULT_CALCULATOR_OUTPUT}"`);
    }
    for (const r of c.results ?? []) {
      if (!c.fields.some((f) => f.name === r && f.formula)) throw new Error(`${raw.domain}: "${c.name}" result "${r}" is not a calculated field`);
    }
    for (const f of c.fields) {
      if (f.formula && f.source) throw new Error(`${raw.domain}: "${c.name}" field "${f.name}" is calculated, so it has no source`);
    }
  }
  return raw;
}

/** A spec field as the calculator_fields row it becomes. */
export function domainFieldToRow(f: DomainSpecField, order: number): ReferenceCalculatorField {
  return {
    field_name: f.name,
    display_label: f.unit ? `${f.name} (${f.unit})` : f.name,
    field_type: f.formula ? 'calculated' : 'number',
    default_value: f.formula ?? null,
    unit: f.unit,
    display_order: order,
    data_source: f.dataSource ?? null,
    source_table: f.sourceTable ?? null,
    source_field: f.sourceField ?? null,
  };
}

/** The spec as the per-operation calculator set an engine receives (ids are the calculator names). */
export function domainCalculatorsAsReference(spec: DomainCalculatorSpec): ReferenceCalculators {
  const out: ReferenceCalculators = {};
  for (const c of spec.calculators) {
    const def = { calculatorId: c.name, name: c.name, version: c.version ?? 1, fields: c.fields.map((f, i) => domainFieldToRow(f, i + 1)) };
    for (const op of c.operations) out[op] = def;
  }
  return out;
}

/** Every calculator of the spec by its name: the way a helper (which no operation maps to) is found. */
export function domainCalculatorsByName(spec: DomainCalculatorSpec): Record<string, ReferenceCalculatorDef> {
  const out: Record<string, ReferenceCalculatorDef> = {};
  for (const c of spec.calculators) {
    out[c.name] = { calculatorId: c.name, name: c.name, version: c.version ?? 1, fields: c.fields.map((f, i) => domainFieldToRow(f, i + 1)) };
  }
  return out;
}

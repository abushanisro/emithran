import type { ReferenceCalculatorField, ReferenceCalculators } from './reference-calculator';

/**
 * A domain's calculator spec (heat treatment, secondary processes, surface
 * treatment): one JSON file per domain, read by that domain's migration
 * generator, by its engine loader, and by tests. Machining and die casting keep
 * their own specs (their fields name lookup tables); this one is for domains
 * whose engine seeds every input itself and shows its source in the trace.
 */
export interface DomainSpecField {
  name: string;
  unit: string | null;
  /** A formula over other fields, written {Field Name}; makes the field calculated. */
  formula?: string;
}

export interface DomainSpecCalculator {
  /** Stable key, used in tests and logs. */
  key: string;
  /** Global calculator name in the database. */
  name: string;
  description: string;
  /** Catalog operations (process_calculator_mappings.operation) this calculator computes. */
  operations: string[];
  fields: DomainSpecField[];
}

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
    if (c.operations.length === 0) throw new Error(`${raw.domain}: calculator "${c.name}" computes no operation`);
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
    if (!c.fields.some((f) => f.name === 'Cycle Time' && f.formula)) {
      throw new Error(`${raw.domain}: "${c.name}" has no calculated "Cycle Time" field`);
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
    data_source: null,
    source_table: null,
    source_field: null,
  };
}

/** The spec as the per-operation calculator set an engine receives (ids are the calculator names). */
export function domainCalculatorsAsReference(spec: DomainCalculatorSpec): ReferenceCalculators {
  const out: ReferenceCalculators = {};
  for (const c of spec.calculators) {
    const def = { calculatorId: c.name, name: c.name, version: 1, fields: c.fields.map((f, i) => domainFieldToRow(f, i + 1)) };
    for (const op of c.operations) out[op] = def;
  }
  return out;
}

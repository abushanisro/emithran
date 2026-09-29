import spec from './machining-calculators.json';
import type { MachiningCalculatorField, MachiningCalculators } from './machining-calculator';

/**
 * The machining calculator spec (machining-calculators.json), expanded:
 * machine-class group names resolved and "sameFieldsAs" copies filled in.
 * Read by the migration generator (scripts/generate-machining-calculators-
 * migration.ts) and by tests. The running engine reads the calculators from
 * the database; it uses the spec only for which machine classes are machining
 * stations (bom-items.service.ts resolveMachiningCalculators) and which lookup
 * tables the calculators name (machining-lookup-tables.ts).
 */
export interface SpecField {
  name: string;
  unit: string | null;
  source?: 'cad' | 'lookup' | 'machine' | 'bom' | 'drawing' | 'engine' | 'default';
  table?: string;
  /** Other tables the same input can come from (the trace names the one used). */
  alsoTables?: string[];
  column?: string;
  default?: number;
  formula?: string;
}

export interface SpecCalculator {
  name: string;
  operation: string;
  description: string;
  machineClasses: string[];
  fields: SpecField[];
}

export interface MachiningCalculatorSpec {
  stations: Record<string, string>;
  calculators: SpecCalculator[];
  retire: string[];
}

export function loadMachiningCalculatorSpec(): MachiningCalculatorSpec {
  const raw = spec as any;
  const groups: Record<string, string[]> = { lathes: raw.lathes, mills: raw.mills };
  const byName = new Map<string, any>(raw.calculators.map((c: any) => [c.name, c]));
  const calculators: SpecCalculator[] = raw.calculators.map((c: any) => {
    const classes: string[] = Array.isArray(c.machineClasses)
      ? c.machineClasses
      : String(c.machineClasses).split('+').flatMap((g: string) => groups[g] ?? []);
    const fields: SpecField[] = c.fields ?? byName.get(c.sameFieldsAs)?.fields;
    if (!fields) throw new Error(`machining calculator "${c.name}" has no fields`);
    for (const cls of classes) {
      if (!raw.stations[cls]) throw new Error(`machining calculator "${c.name}": no catalog station for machine class "${cls}"`);
    }
    return { name: c.name, operation: c.operation, description: c.description, machineClasses: classes, fields };
  });
  return { stations: raw.stations, calculators, retire: raw.retire };
}

/** A spec field as the calculator_fields row it becomes. */
export function specFieldToRow(f: SpecField, order: number): MachiningCalculatorField {
  return {
    field_name: f.name,
    display_label: f.unit ? `${f.name} (${f.unit})` : f.name,
    field_type: f.formula ? 'calculated' : 'number',
    default_value: f.formula ?? (f.default != null ? String(f.default) : null),
    unit: f.unit,
    display_order: order,
    data_source: f.source === 'lookup' ? 'machining_lookup' : null,
    source_table: f.table ?? null,
    source_field: f.column ?? null,
  };
}

/** The spec as the per-operation calculator set the engine receives (ids are the spec names). */
export function specAsCalculators(s: MachiningCalculatorSpec = loadMachiningCalculatorSpec()): MachiningCalculators {
  return Object.fromEntries(s.calculators.map((c) => [c.operation, {
    calculatorId: c.name, name: c.name, version: 1,
    fields: c.fields.map((f, i) => specFieldToRow(f, i + 1)),
  }]));
}

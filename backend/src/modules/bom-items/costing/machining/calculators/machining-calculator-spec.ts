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
  /** A lookup row is the material's row that also has these column values (tblShaping "Cut Type": 1). */
  where?: Record<string, string | number>;
  /** A lookup row is the material's row whose `column` is nearest the product of these inputs (the bevel cutter diameter nearest Module x Teeth). */
  nearest?: { column: string; product: string[] };
  /** A lookup row is the one whose `materialType` column names the material's type (tblChemicalMillingEtchingRates "material_type": Aluminum). */
  materialType?: string;
  /** A lookup row is the first, in ascending order of `column`, that reaches the input's value (the tblChemicalMilling row for a part of this area). */
  band?: { column: string; input: string };
  default?: number;
  formula?: string;
}

/** An operation written as this in the spec is the station itself: the calculator prices the machine's own line ("3 Axis Mill"). */
export const STATION_OPERATION = '{station}';

interface SpecCalculator {
  name: string;
  operation: string;
  /** The migration that ships this calculator; unset = migration 804 (the original set, never regenerated differently). */
  migration?: number;
  /** A later migration that ships this calculator again: it was added to the spec after migration 804 had been applied, so databases that ran the earlier 804 never received it. */
  reissue?: number;
  /**
   * A later migration replaces this calculator with the spec's next entry of the same name. The entry stays, unchanged, because an applied
   * migration (804) is generated from it and must never change; everything else reads only the current entry.
   */
  supersededBy?: number;
  description: string;
  machineClasses: string[];
  fields: SpecField[];
}

export interface MachiningCalculatorSpec {
  stations: Record<string, string>;
  calculators: SpecCalculator[];
  retire: string[];
}

/**
 * The spec's calculators. By default only the current entry of each calculator: one a later migration replaced (supersededBy) is left
 * out. `includeSuperseded` keeps it, for generating the migration that shipped it (804), which must stay byte-identical once applied.
 */
export function loadMachiningCalculatorSpec(opts: { includeSuperseded?: boolean } = {}): MachiningCalculatorSpec {
  const raw = spec as any;
  const groups: Record<string, string[]> = { lathes: raw.lathes, mills: raw.mills };
  const entries = (raw.calculators as any[]).filter((c) => opts.includeSuperseded || !c.supersededBy);
  const byName = new Map<string, any>(entries.map((c: any) => [c.name, c]));
  const calculators: SpecCalculator[] = entries.map((c: any) => {
    const classes: string[] = Array.isArray(c.machineClasses)
      ? c.machineClasses
      : String(c.machineClasses).split('+').flatMap((g: string) => groups[g] ?? []);
    // A superseded entry copies the superseded entry it named, so the migration that shipped it never changes.
    const copied = entries.find((e: any) => e.name === c.sameFieldsAs && !!e.supersededBy === !!c.supersededBy) ?? byName.get(c.sameFieldsAs);
    const fields: SpecField[] = c.fields ?? copied?.fields;
    if (!fields) throw new Error(`machining calculator "${c.name}" has no fields`);
    for (const cls of classes) {
      if (!raw.stations[cls]) throw new Error(`machining calculator "${c.name}": no catalog station for machine class "${cls}"`);
    }
    return { name: c.name, operation: c.operation, description: c.description, machineClasses: classes, fields, ...(c.migration ? { migration: c.migration } : {}), ...(c.reissue ? { reissue: c.reissue } : {}), ...(c.supersededBy ? { supersededBy: c.supersededBy } : {}) };
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
  return Object.fromEntries(s.calculators.flatMap((c) => {
    const def = { calculatorId: c.name, name: c.name, version: 1, fields: c.fields.map((f, i) => specFieldToRow(f, i + 1)) };
    const operations = c.operation === STATION_OPERATION ? c.machineClasses.map((cls) => s.stations[cls]!) : [c.operation];
    return operations.map((op) => [op, def]);
  }));
}

// The sand-casting reference data (memory/Sand casting), as staged by migration 853 under its own source version: the 121 named
// variables of sand_casting_variables.csv and the 22 lookup tables of Lookup/. Pure: the caller loads the rows
// (SandReferenceService); nothing here holds a value.
//
// This is a reader, not a model. It answers "what does the data say for this name" and "which of these names are absent", so a
// step of the route can name exactly what it could not decide (the same rule as the die-casting reference: a missing value is
// reported, never substituted). Typed views of individual tables belong to the step that uses them.

import MANIFEST from '../../../../processes/memory-reference-domains.json';

export const SAND_CASTING_SOURCE_VERSION: string = MANIFEST.domains.find((d) => d.key === 'sand_casting')!.sourceVersion;

/** The staged key of a lookup table is its file name; the table's own name is what the data and its notes use. */
const LOOKUP_KEY_PREFIX = 'lookupTables_Component_';

type Row = Readonly<Record<string, unknown>>;

export interface StagedVariable {
  key: string;
  value: string | null;
  unit_type?: string | null;
}
export interface StagedLookup {
  key: string;
  /** The table's rows: `{ rows: [...] }`, or the bare array of rows as migration 787 staged the Multi-Spindle tables. */
  raw?: { rows?: unknown } | readonly unknown[] | null;
}

export interface SandVariable {
  value: string | null;
  unit: string | null;
}

/** The short name of a staged lookup key: `lookupTables_Component_tblWallThickness` is `tblWallThickness`. */
export const lookupName = (stagedKey: string): string => (stagedKey.startsWith(LOOKUP_KEY_PREFIX) ? stagedKey.slice(LOOKUP_KEY_PREFIX.length) : stagedKey);

/** The staged key to ask for when loading a lookup table by its short name. */
export const stagedLookupKey = (name: string): string => `${LOOKUP_KEY_PREFIX}${name}`;

export class SandReference {
  constructor(
    private readonly variables: ReadonlyMap<string, SandVariable>,
    private readonly tables: ReadonlyMap<string, readonly Row[]>,
    /** The plant value of each variable a part's own value replaces (see withOverrides); empty for the shared reference. */
    private readonly plantValues: ReadonlyMap<string, string | null> = new Map(),
  ) {}

  /**
   * This reference with one part's own values laid over the plant variables (sand_variable_overrides). A new object: the shared reference
   * is never changed. A name that is not a plant variable is ignored here (the writer refuses it; a variable renamed since is simply no longer read).
   */
  withOverrides(values: ReadonlyMap<string, string>): SandReference {
    if (values.size === 0) return this;
    const variables = new Map(this.variables);
    const plant = new Map<string, string | null>();
    for (const [name, value] of values) {
      const original = this.variables.get(name);
      if (!original) continue;
      plant.set(name, original.value);
      variables.set(name, { ...original, value });
    }
    return new SandReference(variables, this.tables, plant);
  }

  /**
   * The plant value of a variable: undefined when it is not a variable, null when it has no value. On a reference with a part's own
   * values laid over it, still the plant value, not the part's.
   */
  plantOrSharedValue(name: string): string | null | undefined {
    if (this.plantValues.has(name)) return this.plantValues.get(name) ?? null;
    const v = this.variables.get(name);
    return v === undefined ? undefined : v.value;
  }

  /** True when a part's own value replaces the plant value of this variable; `plantValue` is what it replaced. */
  overridden(name: string): boolean {
    return this.plantValues.has(name);
  }
  plantValue(name: string): string | null {
    return this.plantValues.get(name) ?? null;
  }

  /** A variable as a number; null when absent or not numeric (an enum such as `autoCoreboxCalcMode` is text, see `text`). */
  number(name: string): number | null {
    const v = this.variables.get(name)?.value;
    if (v == null || v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** A variable as text; null when absent or empty. */
  text(name: string): string | null {
    const v = this.variables.get(name)?.value;
    return v == null || v.trim() === '' ? null : v;
  }

  /**
   * A variable as a yes/no: the data writes its switches as `true` / `false` (usePreferredMachines, enableScrapMaterialCredit, ...); 1 / 0 read
   * the same. Null when absent or anything else. A switch is never read with `number`, which gives null for `true`.
   */
  flag(name: string): boolean | null {
    const v = this.text(name)?.trim().toLowerCase();
    return v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : null;
  }

  /** The unit type the source gives a variable (Length, Time, ...), as staged. */
  unit(name: string): string | null {
    return this.variables.get(name)?.unit ?? null;
  }

  /** A lookup table's rows by its short name (`tblWallThickness`); empty when it is not staged. */
  table(name: string): readonly Row[] {
    return this.tables.get(name) ?? [];
  }

  /**
   * What a step needs but the data lacks, named for the step's `missing` list: a variable that is absent or not a number
   * (`numbers`), absent text (`texts`), a table that is not staged or empty (`tables`).
   */
  absent(needs: { numbers?: readonly string[]; texts?: readonly string[]; tables?: readonly string[] }): string[] {
    return [
      ...(needs.numbers ?? []).filter((n) => this.number(n) == null).map((n) => `sand variable ${n}`),
      ...(needs.texts ?? []).filter((n) => this.text(n) == null).map((n) => `sand variable ${n}`),
      ...(needs.tables ?? []).filter((n) => this.table(n).length === 0).map((n) => `sand lookup ${n} (not staged, migration 853)`),
    ];
  }

  get variableCount(): number {
    return this.variables.size;
  }
  get tableNames(): string[] {
    return [...this.tables.keys()].sort();
  }
}

/** A number written with thousands separators, as some tables are staged ("999,999,999.00", "4,545,454,545.00"): nothing else matches. */
const THOUSANDS = /^\s*-?\d{1,3}(,\d{3})+(\.\d+)?\s*$/;

/**
 * A lookup cell as the number it is written as: a cell with thousands separators loses them (a table's open-ended last row is such a
 * number, and `Number("999,999,999.00")` is not a number, so the row never matched); every other cell is kept as staged.
 */
export const plainCell = (v: unknown): unknown => (typeof v === 'string' && THOUSANDS.test(v) ? v.replace(/[\s,]/g, '') : v);

/** Builds the reference from the staged rows (variables by key, lookup tables by their staged key, each cell as plainCell reads it). */
export function resolveSandReference(rows: { variables: readonly StagedVariable[]; lookups: readonly StagedLookup[] }): SandReference {
  const variables = new Map(rows.variables.map((v) => [v.key, { value: v.value ?? null, unit: v.unit_type ?? null }] as const));
  const tables = new Map<string, readonly Row[]>();
  for (const l of rows.lookups) {
    const staged = Array.isArray(l.raw) ? l.raw : (l.raw as { rows?: unknown } | null | undefined)?.rows;
    if (!Array.isArray(staged)) continue;
    tables.set(lookupName(l.key), (staged as unknown[]).map((row) => (row != null && typeof row === 'object' && !Array.isArray(row)
      ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plainCell(v)]))
      : row) as Row));
  }
  return new SandReference(variables, tables);
}

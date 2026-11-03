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
  raw?: { rows?: unknown } | null;
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
  ) {}

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

/** Builds the reference from the staged rows (variables by key, lookup tables by their staged key). */
export function resolveSandReference(rows: { variables: readonly StagedVariable[]; lookups: readonly StagedLookup[] }): SandReference {
  const variables = new Map(rows.variables.map((v) => [v.key, { value: v.value ?? null, unit: v.unit_type ?? null }] as const));
  const tables = new Map<string, readonly Row[]>();
  for (const l of rows.lookups) {
    const staged = l.raw?.rows;
    if (Array.isArray(staged)) tables.set(lookupName(l.key), staged as Row[]);
  }
  return new SandReference(variables, tables);
}

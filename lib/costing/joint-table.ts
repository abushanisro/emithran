// A Cost Guide table of joints or welds: rows the engineer adds, each of one kind (its process) with the measures that kind takes, stored under
// one scenario key. One model for every such table (Assembly's joints, Part Assembly's welds): a vocabulary says what a row of each kind needs
// and takes; the helpers below read, edit and store the table. Pure.

/** One row as the table stores it: its id and kind, an optional name, whether it is on, and its measures (and any key the engine reads). */
export type TableRow<F extends string = string> = { id: string; process: string; label?: string; enabled?: boolean } & Partial<Record<F, string | number | boolean>>;

/** What a row of each kind takes, for the row dialog. */
export interface RowVocabulary<F extends string> {
  /** Every measure a row can carry. */
  fields: readonly F[];
  /** The kinds a row can be, as the kind select offers them. */
  kinds: readonly { process: string; label: string }[];
  /** The measures a row needs to be costed, and the ones it can also take, for its kind and what is already set on it. */
  required: (row: TableRow<F>) => readonly F[];
  optional: (row: TableRow<F>) => readonly F[];
  /** A text measure's choices for a row; null for a number or a flag. */
  choices: (field: F, row: TableRow<F>) => readonly string[] | null;
  /** A measure's name for a row ("Leg (mm)" on a fillet, "Hole Ø (mm)" on a plug). */
  label: (field: F, row: TableRow<F>) => string;
  /** What an empty number measure falls back to, shown in the field ("3, the components'"). */
  placeholder?: (field: F, row: TableRow<F>) => string | undefined;
  /** The measures shown as checkboxes. */
  flags: ReadonlySet<F>;
  /** The row when its kind is changed: what it keeps of the old one. */
  rekind: (row: TableRow<F>, process: string) => TableRow<F>;
}

const isRow = (r: unknown): r is TableRow => !!r && typeof r === 'object' && typeof (r as TableRow).id === 'string' && typeof (r as TableRow).process === 'string';

/** The table stored under `key` (rows the engine can read; anything else is dropped here, as the engine reports it). */
export function tableOf<F extends string>(key: string, overrides: Record<string, unknown> | null | undefined): TableRow<F>[] {
  const raw = overrides?.[key];
  return Array.isArray(raw) ? raw.filter(isRow) : [];
}

/** The table with `row` in it: replacing the row of its id, else added. */
export function withRow<F extends string>(table: readonly TableRow<F>[], row: TableRow<F>): TableRow<F>[] {
  return table.some((r) => r.id === row.id) ? table.map((r) => (r.id === row.id ? row : r)) : [...table, row];
}

/** The table without the row of `id`. */
export function withoutRow<F extends string>(table: readonly TableRow<F>[], id: string): TableRow<F>[] {
  return table.filter((r) => r.id !== id);
}

/** A new row's id, unique in the table ("joint-3", "weld-2"). */
export function newRowId(table: readonly TableRow[], prefix: string): string {
  let n = table.length + 1;
  while (table.some((r) => r.id === `${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

/** The scenario patch that stores the table under `key` (an empty table clears the key). */
export function tablePatch(key: string, table: readonly TableRow[]): Record<string, unknown> {
  return { [key]: table.length ? table : null };
}

const isSet = (v: unknown) => v != null && v !== '' && (typeof v !== 'number' || v > 0);

/** The measures a row still needs for its kind. */
export function missingMeasures<F extends string>(vocabulary: RowVocabulary<F>, row: TableRow<F>): F[] {
  return vocabulary.required(row).filter((f) => !isSet(row[f]));
}

/** The row as it is saved: a measure its kind does not take is dropped (any other key, such as one the engine adds, is kept). */
export function prunedRow<F extends string>(vocabulary: RowVocabulary<F>, row: TableRow<F>): TableRow<F> {
  const takes = new Set<string>([...vocabulary.required(row), ...vocabulary.optional(row)]);
  const measures = new Set<string>(vocabulary.fields);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !measures.has(k) || takes.has(k))) as TableRow<F>;
}

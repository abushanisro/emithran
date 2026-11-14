// The reference table a calculator input is picked from (ReferenceTable.tsx): its last column is the value a row gives the input.

export interface ReferenceColumn {
  name: string;
  label: string;
  unit?: string | null;
}

/** The column a row's value is taken from: the last one. */
export function outputColumn<C extends ReferenceColumn>(columns: readonly C[]): C | undefined {
  return columns[columns.length - 1];
}

/** The value a picked cell gives the input: a number when it reads as one (zero included), otherwise the text as is. */
export function pickedValue(v: unknown): unknown {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return v;
}

/** A cell as shown: an empty cell is a dash. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v.toString();
  return JSON.stringify(v);
}

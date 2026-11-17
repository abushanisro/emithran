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

/** The fewest and most characters a column is sized for: a unit still gets room for its header, and one long note does not take the whole table. */
const MIN_COLUMN_CHARS = 6;
const MAX_COLUMN_CHARS = 36;

/**
 * Each column's share of the table width (percent, summing to 100), by the longest text it shows: its header or its widest cell, between
 * MIN_COLUMN_CHARS and MAX_COLUMN_CHARS. The table is laid out to these shares so every column is in view at once and long text wraps in its
 * own column, instead of the table growing wider than its panel and hiding columns behind the pinned value column.
 */
export function columnShares(columns: readonly ReferenceColumn[], rows: readonly Record<string, unknown>[], cell: (row: Record<string, unknown>, column: string) => unknown): number[] {
  const chars = columns.map((c) => {
    const header = c.label.length + (c.unit ? c.unit.length + 3 : 0);
    const widest = rows.reduce((max, row) => Math.max(max, cellText(cell(row, c.name)).length), header);
    return Math.min(MAX_COLUMN_CHARS, Math.max(MIN_COLUMN_CHARS, widest));
  });
  const total = chars.reduce((a, b) => a + b, 0);
  return chars.map((n) => (100 * n) / total);
}

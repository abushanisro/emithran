// Which rows of a lookup table the calculator is using: one row for an exact
// match, or the two real rows an interpolated value sits between.
export type MatchedRowKeys = Record<string, unknown> | Record<string, unknown>[] | null | undefined;

// The API camelCases response keys (thickness_mm -> thicknessMm), but column
// definitions and some callers still use the database spelling. Compare keys
// spelling-insensitively so one side's casing can never decide a match.
export const columnKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** A column value by either spelling (thickness_mm or thicknessMm). */
export function columnValue(row: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!row) return undefined;
  return row[key] ?? row[columnKey(key)];
}

// A cell as text: rows hold strings and numbers only; anything else never matches.
const text = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

/** True when `row` is one of the rows the lookup resolved to. */
export function isMatchedLookupRow(row: Record<string, unknown>, matched: MatchedRowKeys): boolean {
  if (!matched) return false;
  const rowByKey = new Map(Object.entries(row).map(([k, v]) => [columnKey(k), v]));
  const candidates = Array.isArray(matched) ? matched : [matched];
  return candidates.some((keys) => {
    let compared = 0;
    for (const [key, expected] of Object.entries(keys)) {
      const actual = rowByKey.get(columnKey(key));
      if (actual === undefined) continue; // column not on this row shape (e.g. an interpolation note)
      compared++;
      const equal = typeof expected === 'number' || typeof actual === 'number'
        ? Math.abs(Number(actual) - Number(expected)) < 1e-6
        : text(actual) !== null && text(actual) === text(expected);
      if (!equal) return false;
    }
    return compared > 0; // a row that shares no column with the match is never "the row in use"
  });
}

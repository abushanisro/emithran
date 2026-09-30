/**
 * PostgREST returns at most this many rows per request (Supabase `max_rows`),
 * whatever `.limit()` or `.range()` asks for. A single request for more is
 * silently truncated: no error, just fewer rows. Confirmed live on this
 * project: 1734 USA machines came back as the newest 1000, dropping whole
 * process groups from HR Rates and every injection press from machine
 * selection.
 */
export const POSTGREST_MAX_ROWS = 1000;

export interface RowPage<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * Every row of a query, read in pages of POSTGREST_MAX_ROWS.
 *
 * `page(from, to)` must return the query with `.range(from, to)` applied and a
 * TOTAL ordering (end on a unique column such as `id`), or consecutive pages
 * can overlap or skip rows that tie on the sort key.
 *
 * `window` restricts the read to rows `from..to` (inclusive) of that ordering,
 * for a caller that itself serves one page of a larger result.
 */
export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<RowPage<T>>,
  window: { from: number; to: number } = { from: 0, to: Number.MAX_SAFE_INTEGER },
): Promise<{ data: T[]; error: { message: string } | null; count: number | null }> {
  const data: T[] = [];
  let count: number | null = null;
  for (let start = window.from; start <= window.to; start += POSTGREST_MAX_ROWS) {
    const end = Math.min(start + POSTGREST_MAX_ROWS - 1, window.to);
    const res = await page(start, end);
    if (res.error) return { data, error: res.error, count };
    if (count == null) count = res.count ?? null;
    const rows = res.data ?? [];
    data.push(...rows);
    if (rows.length < end - start + 1) break;
  }
  return { data, error: null, count };
}

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

/**
 * readAllRows with the pages after the first read at the same time. A table of N rows is
 * ceil(N / 1000) pages; read one after another they cost N/1000 round trips of latency (the HR Rates
 * picker, 2,000+ rows for one location, was seconds of waiting for it), read together they cost one.
 *
 * The first page must return the total (`count`): ask for it on the first page only, e.g.
 * `.select(columns, from === 0 ? { count: 'exact' } : undefined)`. Without a total the remaining
 * pages are read one after another, as readAllRows does. The ordering contract is the same as
 * readAllRows (total ordering, ending on a unique column).
 */
export async function readAllRowsConcurrent<T>(
  page: (from: number, to: number) => PromiseLike<RowPage<T>>,
  concurrency = 4,
): Promise<{ data: T[]; error: { message: string } | null; count: number | null }> {
  const first = await page(0, POSTGREST_MAX_ROWS - 1);
  if (first.error) return { data: [], error: first.error, count: null };
  const data: T[] = [...(first.data ?? [])];
  const count = first.count ?? null;
  if (data.length < POSTGREST_MAX_ROWS) return { data, error: null, count: count ?? data.length };
  if (count == null) {
    const rest = await readAllRows(page, { from: POSTGREST_MAX_ROWS, to: Number.MAX_SAFE_INTEGER });
    return { data: [...data, ...rest.data], error: rest.error, count: null };
  }
  const starts: number[] = [];
  for (let start = POSTGREST_MAX_ROWS; start < count; start += POSTGREST_MAX_ROWS) starts.push(start);
  for (let i = 0; i < starts.length; i += concurrency) {
    const batch = starts.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((start) => page(start, Math.min(start + POSTGREST_MAX_ROWS - 1, count - 1))));
    for (const res of results) {
      if (res.error) return { data, error: res.error, count };
      data.push(...(res.data ?? []));
    }
  }
  return { data, error: null, count };
}

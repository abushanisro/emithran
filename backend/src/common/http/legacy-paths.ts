/**
 * Paths that were renamed to follow docs/API.md (plural nouns, no verbs). A request that still uses the old path is routed to the new
 * one and answered with Deprecation and a Link to the successor (common/http/api-v1.ts), so the controllers carry only the new name
 * and the route inventory lists each route once.
 *
 * `from` and `to` are paths after the API prefix, matched on whole segments; the longest `from` wins. Remove a rule once the
 * deprecated-path log shows no traffic for 30 days.
 */
const RULES: Array<readonly [from: string, to: string]> = [
  ['rfq/tracking', 'rfq-trackings'],
  ['rfq', 'rfqs'],
  ['fx/exchange-rates', 'exchange-rates'],
  ['fx/currencies', 'currencies'],
  ['fx/factories', 'factories'],
  ['fx/factory-currency', 'factory-currencies'],
  ['fx/rate', 'exchange-rates/effective'],
  ['fx/refresh', 'exchange-rates/refresh'],
  ['lhr/import-excel', 'labour-rates/imports'],
  ['mhr/import-excel', 'machine-rates/imports'],
  ['lhr/bulk', 'labour-rates/batches'],
  ['lhr', 'labour-rates'],
  ['mhr', 'machine-rates'],
];

export const RENAMED_PATHS: ReadonlyArray<readonly [from: string, to: string]> = [...RULES].sort((a, b) => b[0].length - a[0].length);

/** The new path for an old one (no query string), or null when the path was not renamed. */
export function renamedPath(path: string): string | null {
  for (const [from, to] of RENAMED_PATHS) {
    if (path === from) return to;
    if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  }
  return null;
}

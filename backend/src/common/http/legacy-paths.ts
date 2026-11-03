/**
 * Paths that were renamed to follow docs/API.md (plural nouns, no verbs). A request that still uses the old path is routed to the new
 * one and answered with Deprecation and a Link to the successor (common/http/api-v1.ts), so the controllers carry only the new name
 * and the route inventory lists each route once.
 *
 * `from` and `to` are paths after the API prefix, matched on whole segments. A `:name` segment in `from` matches any one segment and
 * is copied to the same `:name` in `to`; whatever follows the matched segments is kept. The rule with the most segments wins, then
 * the first listed. Remove a rule once the deprecated-path log shows no traffic for 30 days.
 */
const RULES: Array<readonly [from: string, to: string]> = [
  // rates
  ['lhr/import-excel', 'labour-rates/imports'],
  ['mhr/import-excel', 'machine-rates/imports'],
  ['lhr/bulk', 'labour-rates/batches'],
  ['lhr', 'labour-rates'],
  ['mhr', 'machine-rates'],
  // rfqs and exchange rates
  ['rfq/tracking', 'rfq-trackings'],
  ['rfq', 'rfqs'],
  ['fx/exchange-rates', 'exchange-rates'],
  ['fx/currencies', 'currencies'],
  ['fx/factories', 'factories'],
  ['fx/factory-currency', 'factory-currencies'],
  ['fx/rate', 'exchange-rates/effective'],
  ['fx/refresh', 'exchange-rates/refresh'],
  // production planning
  ['production-planning/dashboard', 'production-lots/dashboard'],
  ['production-planning/process-templates', 'production-process-templates'],
  ['production-planning/lots', 'production-lots'],
  ['production-planning/processes', 'production-processes'],
  ['production-planning/subtasks', 'production-subtasks'],
  ['production-planning/production-entries', 'production-entries'],
  ['production-planning/materials', 'production-materials'],
  ['production-planning/alerts', 'production-alerts'],
  // VAVE, quality inspections, knowledge base, process specifications, PDF documents
  ['vave/projects/:id/bom/bulk', 'vave-projects/:id/bom/batches'],
  ['vave/projects/:id/ideas/bulk', 'vave-projects/:id/ideas/batches'],
  ['vave/projects', 'vave-projects'],
  ['vave/ai/bom-analysis', 'vave-bom-analyses'],
  ['quality-control/inspections', 'quality-inspections'],
  ['manufacturing-knowledge/feature-process-mapping', 'feature-process-mappings'],
  ['manufacturing-knowledge/machine-capabilities', 'machine-capabilities'],
  ['manufacturing-knowledge/routing-rules', 'routing-rules'],
  ['manufacturing-knowledge/templates', 'routing-templates'],
  ['process-planning/bom-items/:bomItemId/specifications', 'bom-items/:bomItemId/process-specifications'],
  ['process-planning/specifications/upsert', 'process-specifications'],
  ['pdf-processing/extract-dimensions', 'pdf-documents/dimension-extractions'],
  ['pdf-processing/validate-pdf', 'pdf-documents/validations'],
];

interface Rule { from: string[]; to: string[] }

export const RENAMED_PATHS: ReadonlyArray<Rule> = RULES.map(([from, to]) => ({ from: from.split('/'), to: to.split('/') }))
  .sort((a, b) => b.from.length - a.from.length); // stable: equal lengths keep the order above

/** The new path for an old one (no query string), or null when the path was not renamed. */
export function renamedPath(path: string): string | null {
  const segments = path.split('/');
  for (const rule of RENAMED_PATHS) {
    if (segments.length < rule.from.length) continue;
    const captured = new Map<string, string>();
    const matches = rule.from.every((part, i) => {
      if (part.startsWith(':')) { captured.set(part, segments[i]); return segments[i] !== ''; }
      return part === segments[i];
    });
    if (!matches) continue;
    const head = rule.to.map((part) => (part.startsWith(':') ? captured.get(part) ?? part : part));
    return [...head, ...segments.slice(rule.from.length)].join('/');
  }
  return null;
}

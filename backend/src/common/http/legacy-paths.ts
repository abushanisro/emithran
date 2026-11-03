/**
 * Paths that were renamed to follow docs/API.md (plural nouns, no verbs). A request that still uses the old path is routed to the new
 * one and answered with Deprecation and a Link to the successor (common/http/api-v1.ts), so the controllers carry only the new name
 * and the route inventory lists each route once.
 *
 * `from` and `to` are paths after the API prefix, matched on whole segments. A `:name` segment in `from` matches any one segment and
 * is copied to the same `:name` in `to`; whatever follows the matched segments is kept. The rule with the most segments wins, then
 * the first listed. A rule goes only after the Sunset date, announced in advance (docs/API.md), not when traffic reaches zero.
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
  // verbs to nouns: imports, analyses, conversions, totals, calculations, matches, rankings, deletion checks
  ['bom-items/analyze-for-autofill/start', 'bom-items/autofill-analysis-jobs'],
  ['bom-items/analyze-for-autofill/:jobId', 'bom-items/autofill-analysis-jobs/:jobId'],
  ['bom-items/analyze-for-autofill', 'bom-items/autofill-analyses'],
  ['bom-items/:id/analyze-cad', 'bom-items/:id/cad-analyses'],
  ['bom-items/:id/analyze-drawing', 'bom-items/:id/drawing-analyses'],
  ['bom-items/batch-analyze-cad', 'bom-items/cad-analysis-batches'],
  ['bom-items/:id/apply-custom-route', 'bom-items/:id/custom-route-applications'],
  ['bom-items/:id/apply-route', 'bom-items/:id/route-applications'],
  ['bom-items/:id/convert-step', 'bom-items/:id/step-conversions'],
  ['bom-items/:id/upload-files', 'bom-items/:id/files'],
  ['boms/:id/recalculate-all-costs', 'boms/:id/cost-recalculations'],
  ['child-part-costs/calculate', 'child-part-costs/calculations'],
  ['process-costs/calculate', 'process-costs/calculations'],
  ['process-costs/bulk-total', 'process-costs/totals'],
  ['packaging-logistics-costs/bulk-total', 'packaging-logistics-costs/totals'],
  ['procured-parts-costs/bulk-total', 'procured-parts-costs/totals'],
  ['raw-material-costs/bulk-total', 'raw-material-costs/totals'],
  ['tooling-costs/bulk-total', 'tooling-costs/totals'],
  ['calculators/sheet-metal/lookup', 'calculators/sheet-metal/lookups'],
  ['processes/calculator-mappings/import-excel', 'processes/calculator-mappings/imports'],
  ['processes/reference-tables/:tableId/rows/bulk', 'processes/reference-tables/:tableId/row-batches'],
  ['raw-materials/upload-excel', 'raw-materials/imports'],
  ['vendors/upload-csv', 'vendors/imports'],
  ['vendors/match', 'vendors/matches'],
  ['supplier-nominations/:nominationId/calculate-rankings', 'supplier-nominations/:nominationId/rankings/calculations'],
  ['supplier-nominations/:nominationId/store-rankings', 'supplier-nominations/:nominationId/rankings'],
  ['supplier-nominations/:id/capability-scores/init', 'supplier-nominations/:id/capability-scores'],
  ['supplier-nominations/:id/capability-scores/batch', 'supplier-nominations/:id/capability-scores'],
  ['supplier-nominations/:nominationId/vendors/:vendorId/rating-matrix/init', 'supplier-nominations/:nominationId/vendor-ratings/:vendorId'],
  ['supplier-nominations/:nominationId/vendors/:vendorId/rating-matrix/batch', 'supplier-nominations/:nominationId/vendor-ratings/:vendorId'],
  ['supplier-nominations/:nominationId/parts/:bomItemId/cost-analysis/init', 'supplier-nominations/:nominationId/part-cost-analyses/:bomItemId'],
  ['supplier-nominations/:nominationId/parts/:bomItemId/cost-analysis/bulk', 'supplier-nominations/:nominationId/part-cost-analyses/:bomItemId'],
  ['supplier-evaluation-groups/:id/validate-deletion', 'supplier-evaluation-groups/:id/deletion-check'],
  ['project-reports/projects/:projectId/complete-report', 'project-reports/projects/:projectId/full-report'],
  ['production-planning/lots/:id/update-status-by-progress', 'production-lots/:id/status-updates'],
  ['production-planning/lots/:lotId/materials/initialize', 'production-lots/:lotId/materials'],
  // flat resources: area names that only added a level of nesting
  ['electronics/designs', 'electronic-designs'],
  ['electronics/uploads', 'electronic-uploads'],
  ['electronics/jobs', 'electronic-jobs'],
  ['electronics/results', 'electronic-results'],
  ['electronics/quotes', 'electronic-quotes'],
  ['electronics/file-formats', 'electronic-file-formats'],
  ['electronics/reference-coverage', 'electronic-coverage-reports'],
  ['project-reports/balloon-diagrams', 'balloon-diagrams'],
  ['copilot/memory/proposals', 'copilot/memory-proposals'],
  ['processes/sm-lookup-tables/rows', 'processes/sm-lookup-table-rows'],
  ['processes/reference-tables/:tableId/rows/batches', 'processes/reference-tables/:tableId/row-batches'],
  ['vave/projects/:id/ai/should-cost/:itemId', 'vave-projects/:id/should-cost-estimates/:itemId'],
  ['supplier-nominations/:nominationId/vendors/:vendorId/rating-matrix/overall-scores', 'supplier-nominations/:nominationId/vendor-overall-scores/:vendorId'],
  ['supplier-nominations/:nominationId/vendors/:vendorId/rating-matrix', 'supplier-nominations/:nominationId/vendor-ratings/:vendorId'],
  ['supplier-nominations/:nominationId/parts/:bomItemId/cost-analysis', 'supplier-nominations/:nominationId/part-cost-analyses/:bomItemId'],
  ['supplier-nominations/:id/capability-scores/:criteriaId/vendor/:vendorId', 'supplier-nominations/:id/capability-scores/:criteriaId/:vendorId'],
  ['supplier-nominations/evaluations/:evaluationId/sections/:section', 'supplier-nominations/evaluation-sections/:evaluationId/:section'],
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

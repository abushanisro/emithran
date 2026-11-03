import * as fs from 'fs';
import * as path from 'path';

import { RENAMED_PATHS, renamedPath } from './legacy-paths';

describe('renamedPath', () => {
  it.each([
    ['mhr', 'machine-rates'],
    ['mhr/42', 'machine-rates/42'],
    ['mhr/42/reference-detail', 'machine-rates/42/reference-detail'],
    ['mhr/picker', 'machine-rates/picker'],
    ['lhr', 'labour-rates'],
    ['lhr/code/L-1', 'labour-rates/code/L-1'],
    ['rfq', 'rfqs'],
    ['rfq/9/send', 'rfqs/9/send'],
    ['rfq/tracking', 'rfq-trackings'],
    ['rfq/tracking/stats', 'rfq-trackings/stats'],
    ['fx/exchange-rates/EUR', 'exchange-rates/EUR'],
    ['fx/currencies', 'currencies'],
    ['fx/factories', 'factories'],
    ['fx/factory-currency', 'factory-currencies'],
    ['fx/rate', 'exchange-rates/effective'],
    ['fx/refresh', 'exchange-rates/refresh'],
  ])('%s becomes %s', (from, to) => {
    expect(renamedPath(from)).toBe(to);
  });

  it('renames the verb paths as a whole, before the resource name', () => {
    expect(renamedPath('mhr/import-excel')).toBe('machine-rates/imports');
    expect(renamedPath('lhr/import-excel')).toBe('labour-rates/imports');
    expect(renamedPath('lhr/bulk')).toBe('labour-rates/batches');
  });

  it.each(['machine-rates', 'machine-rates/1', 'projects', 'mhrs', 'mhrx/1', 'x/mhr', 'rfqs', 'rfq-trackings', 'fx', 'fxx/1', ''])('leaves %j alone', (path) => {
    expect(renamedPath(path)).toBeNull();
  });
});

describe('renamedPath with placeholders', () => {
  it('copies a matched segment into the new path and keeps what follows', () => {
    expect(renamedPath('vave/projects/42/bom/bulk')).toBe('vave-projects/42/bom/batches');
    expect(renamedPath('vave/projects/42/ideas/bulk')).toBe('vave-projects/42/ideas/batches');
    expect(renamedPath('vave/projects/42/bom/7')).toBe('vave-projects/42/bom/7');
    expect(renamedPath('process-planning/bom-items/b1/specifications')).toBe('bom-items/b1/process-specifications');
  });

  it('prefers the more specific rule', () => {
    expect(renamedPath('vave/projects')).toBe('vave-projects');
    expect(renamedPath('vave/ai/bom-analysis')).toBe('vave-bom-analyses');
    expect(renamedPath('vave/projects/9/ai/ideation')).toBe('vave-projects/9/ai/ideation');
  });

  it('does not match a placeholder against a missing segment', () => {
    expect(renamedPath('vave/projects/bom/bulk')).toBe('vave-projects/bom/bulk'); // the shorter rule applies, the bulk rule needs an id
  });
});

describe('every rename points at a route that exists', () => {
  const snapshot = fs.readFileSync(path.resolve(__dirname, '../../test/common/authz/__snapshots__/route-policies.spec.ts.snap'), 'utf8');
  const routes = snapshot.split('\n').flatMap((line) => {
    const m = /^"?\S+\s+(?:GET|POST|PUT|PATCH|DELETE)\s+\/v1\/api\/(\S+)\s/.exec(line);
    return m ? [m[1].split('/')] : [];
  });

  it.each(RENAMED_PATHS.map((r) => [r.from.join('/'), r.to.join('/'), r.to] as const))('%s -> %s', (_from, _to, to) => {
    const found = routes.some((segments) => segments.length >= to.length && to.every((part, i) => part.startsWith(':') || segments[i].startsWith(':') || part === segments[i]));
    expect(found).toBe(true);
  });
});

describe('verb paths become nouns', () => {
  it.each([
    ['bom-items/analyze-for-autofill', 'bom-items/autofill-analyses'],
    ['bom-items/analyze-for-autofill/start', 'bom-items/autofill-analysis-jobs'],
    ['bom-items/analyze-for-autofill/j7', 'bom-items/autofill-analysis-jobs/j7'],
    ['bom-items/b1/analyze-cad', 'bom-items/b1/cad-analyses'],
    ['bom-items/b1/upload-files', 'bom-items/b1/files'],
    ['bom-items/batch-analyze-cad', 'bom-items/cad-analysis-batches'],
    ['boms/b1/recalculate-all-costs', 'boms/b1/cost-recalculations'],
    ['process-costs/bulk-total', 'process-costs/totals'],
    ['tooling-costs/calculate', null],
    ['child-part-costs/calculate', 'child-part-costs/calculations'],
    ['raw-materials/upload-excel', 'raw-materials/imports'],
    ['vendors/upload-csv', 'vendors/imports'],
    ['vendors/match', 'vendors/matches'],
    ['supplier-nominations/n1/calculate-rankings', 'supplier-nominations/n1/rankings/calculations'],
    ['supplier-nominations/n1/capability-scores/init', 'supplier-nominations/n1/capability-scores'],
    ['supplier-nominations/n1/capability-scores/batch', 'supplier-nominations/n1/capability-scores'],
    ['supplier-nominations/n1/parts/p1/cost-analysis/bulk', 'supplier-nominations/n1/parts/p1/cost-analysis'],
    ['production-planning/lots/l1/update-status-by-progress', 'production-lots/l1/status-updates'],
    ['production-planning/lots/l1/materials/initialize', 'production-lots/l1/materials'],
    ['project-reports/projects/p1/complete-report', 'project-reports/projects/p1/full-report'],
  ])('%s -> %s', (from, to) => {
    expect(renamedPath(from)).toBe(to);
  });
});

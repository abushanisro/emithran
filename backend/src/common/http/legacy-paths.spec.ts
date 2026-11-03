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

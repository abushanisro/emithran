import { renamedPath } from './legacy-paths';

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
